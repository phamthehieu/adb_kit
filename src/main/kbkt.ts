import { readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'

/*
 * KBKT ("kịch bản kiểm thử") Excel files, two company layouts:
 *  - BES : labels C2..C10 / values D2..D10, header row 12 (merged 12:13), data from 14.
 *          A code (formula) · B purpose · C steps · D expected · E/F/G result try 1/2/3 · H final · I note.
 *          Group rows: B:C merged, yellow.
 *  - BCCS: labels B2..B10 / values C2..C10, header row 13, data from 14.
 *          A TCID (=$C$3) · B summary · C steps · D test data · E expected · F priority · G repository · H result.
 *          Group rows: A:H merged, blue. One result column → failure detail goes into a cell note.
 */

export type LayoutId = 'BES' | 'BCCS'

interface Layout {
  id: LayoutId
  meta: { title: string; code: string; author: string; tester: string }
  counts: { p: string; f: string; pe: string; notRun: string; total: string }
  firstRow: number
  /** Template rows whose styles are copied for group / test-case rows. */
  groupStyleRow: number
  caseStyleRow: number
  lastCol: number
  groupMerge: (r: number) => string
  groupCol: number
}

const LAYOUTS: Record<LayoutId, Layout> = {
  BES: {
    id: 'BES',
    meta: { title: 'D2', code: 'D3', author: 'D4', tester: 'D5' },
    counts: { p: 'D6', f: 'D7', pe: 'D8', notRun: 'D9', total: 'D10' },
    firstRow: 14,
    groupStyleRow: 14,
    caseStyleRow: 16,
    lastCol: 9,
    groupMerge: (r) => `B${r}:C${r}`,
    groupCol: 2
  },
  BCCS: {
    id: 'BCCS',
    meta: { title: 'C2', code: 'C3', author: 'C4', tester: 'C5' },
    counts: { p: 'C6', f: 'C7', pe: 'C8', notRun: 'C9', total: 'C10' },
    firstRow: 14,
    groupStyleRow: 14,
    caseStyleRow: 15,
    lastCol: 8,
    groupMerge: (r) => `A${r}:H${r}`,
    groupCol: 1
  }
}

const LAST = 2000

/** Plain text of a cell: strings, numbers, rich text, hyperlinks and formula results. */
function text(c: ExcelJS.Cell): string {
  const v = c.value as unknown
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim()
  if (v instanceof Date) return v.toISOString()
  const o = v as { richText?: { text: string }[]; text?: string; result?: unknown; formula?: string }
  if (o.richText) return o.richText.map((t) => t.text).join('').trim()
  if (o.text !== undefined) return String(o.text).trim()
  if (o.formula !== undefined) return o.result === undefined || o.result === null ? '' : String(o.result).trim()
  return ''
}

/** Recognise the layout of a sheet from its header row. */
export function detectLayout(ws: ExcelJS.Worksheet): LayoutId | null {
  if (/TCID/i.test(text(ws.getCell('A13'))) && /summary/i.test(text(ws.getCell('B13')))) return 'BCCS'
  if (/Mã trường hợp/i.test(text(ws.getCell('A12'))) && /Mục đích/i.test(text(ws.getCell('B12')))) return 'BES'
  return null
}

/**
 * Load an xlsx with ExcelJS. Company templates carry data validations / conditional
 * formats over millions of cells, which ExcelJS expands one by one and hangs on — keep
 * only references inside the normal data area (columns A..K, up to 4-digit rows).
 */
async function load(path: string): Promise<ExcelJS.Workbook> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const sane = (ref: string): string => ref.split(' ').filter((r) => /^[A-K]\d{1,4}(:[A-K]\d{1,4})?$/.test(r)).join(' ')
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    let xml = await zip.file(name)!.async('string')
    xml = xml.replace(/<dataValidation\b([^>]*?)sqref="([^"]*)"([^>]*)>([\s\S]*?)<\/dataValidation>/g, (_m, a: string, ref: string, b: string, body: string) => {
      const keep = sane(ref)
      return keep ? `<dataValidation${a}sqref="${keep}"${b}>${body}</dataValidation>` : ''
    })
    xml = xml.replace(/<dataValidations count="\d+">\s*<\/dataValidations>/, '')
    xml = xml.replace(/<conditionalFormatting sqref="([^"]*)">([\s\S]*?)<\/conditionalFormatting>/g, (_m, ref: string, body: string) => {
      const keep = sane(ref)
      return keep ? `<conditionalFormatting sqref="${keep}">${body}</conditionalFormatting>` : ''
    })
    zip.file(name, xml)
  }
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml') // stale after we rewrite formulas; Excel rebuilds it
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''))
    const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
    zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/, ''))
  }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await zip.generateAsync({ type: 'nodebuffer' })) as unknown as ExcelJS.Buffer)
  return wb
}

/* ------------------------------------------------------------------ write */

export interface KbktCase {
  group: string
  purpose: string
  steps: string
  /** Test data (BCCS column D; BES: appended to steps). */
  data?: string
  expected: string
  /** One entry per attempt: KQ lần 1 / 2 / 3. */
  results: ('P' | 'F' | 'PE')[]
  note: string
  /** Absolute path of the HTML report, linked from the note. */
  report?: string
}

export interface KbktSheet {
  title: string
  code: string
  author: string
  tester: string
  cases: KbktCase[]
}

type RowStyle = { height?: number; cells: Partial<ExcelJS.Style>[]; values: unknown[] }

function grab(ws: ExcelJS.Worksheet, r: number, cols: number): RowStyle {
  const row = ws.getRow(r)
  const cells: Partial<ExcelJS.Style>[] = []
  const values: unknown[] = []
  for (let c = 1; c <= cols; c++) {
    cells.push(structuredClone(row.getCell(c).style))
    values.push(row.getCell(c).value)
  }
  return { height: row.height, cells, values }
}

function applyStyle(ws: ExcelJS.Worksheet, r: number, st: RowStyle): void {
  const row = ws.getRow(r)
  st.cells.forEach((s, i) => (row.getCell(i + 1).style = structuredClone(s)))
}

function heightFor(texts: string[], widths: number[]): number {
  let lines = 1
  texts.forEach((t, i) => {
    const w = Math.max(10, widths[i] ?? 40)
    const n = t.split('\n').reduce((acc, l) => acc + Math.max(1, Math.ceil(l.length / (w * 1.1))), 0)
    lines = Math.max(lines, n)
  })
  return Math.min(409, Math.max(18, lines * 13.5 + 4))
}

const finalOf = (results: string[]): string => results[results.length - 1] ?? ''

/** Fill a template (BES / BCCS / custom with the same structure) and save it to `out`. */
export async function writeKbkt(templatePath: string, out: string, sheet: KbktSheet): Promise<LayoutId> {
  const wb = await load(templatePath)
  const ws = wb.worksheets.find((w) => detectLayout(w)) ?? wb.worksheets[0]
  const id = detectLayout(ws)
  if (!id) throw new Error('Không nhận dạng được mẫu KBKT (cần mẫu BES hoặc BCCS)')
  const L = LAYOUTS[id]
  // Reference files ship several sample sheets: keep only the one we fill.
  for (const other of [...wb.worksheets]) if (other !== ws) wb.removeWorksheet(other.id)
  wb.calcProperties.fullCalcOnLoad = true

  const groupStyle = grab(ws, L.groupStyleRow, L.lastCol)
  const caseStyle = grab(ws, L.caseStyleRow, L.lastCol)
  const blank = grab(ws, ws.rowCount + 5, L.lastCol)

  // Clear the template's sample content below the header.
  for (const m of [...(ws.model.merges ?? [])]) if (Number(/\d+/.exec(m)?.[0]) >= L.firstRow) ws.unMergeCells(m)
  for (let r = L.firstRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= Math.max(11, L.lastCol); c++) {
      row.getCell(c).value = null
      row.getCell(c).note = undefined as unknown as string
    }
    applyStyle(ws, r, blank)
    row.height = undefined as unknown as number
  }

  ws.getCell(L.meta.title).value = sheet.title
  ws.getCell(L.meta.code).value = sheet.code
  ws.getCell(L.meta.author).value = sheet.author || null
  ws.getCell(L.meta.tester).value = sheet.tester || null
  const res = 'H' // final result column in both layouts
  const countCol = id === 'BES' ? 'D' : 'B'
  ws.getCell(L.counts.p).value = { formula: `COUNTIF(${res}${L.firstRow}:${res}${LAST},"P")` }
  ws.getCell(L.counts.f).value = { formula: `COUNTIF(${res}${L.firstRow}:${res}${LAST},"F")` }
  ws.getCell(L.counts.pe).value = { formula: `COUNTIF(${res}${L.firstRow}:${res}${LAST},"PE")` }
  ws.getCell(L.counts.notRun).value = { formula: `${L.counts.total}-${L.counts.p}-${L.counts.f}-${L.counts.pe}` }
  // Test-case rows have this column filled; group rows don't (BES: expected · BCCS: summary).
  ws.getCell(L.counts.total).value = { formula: `COUNTA($${countCol}$${L.firstRow}:$${countCol}$${LAST})` }

  const widths = [2, 3, 4, 5].map((c) => ws.getColumn(c).width ?? 40)
  let r = L.firstRow
  let lastGroup: string | null = null
  for (const t of sheet.cases) {
    if (t.group && t.group !== lastGroup) {
      applyStyle(ws, r, groupStyle)
      ws.mergeCells(L.groupMerge(r))
      if (id === 'BES') ws.getCell(`A${r}`).value = { formula: `IF($D${r}="","",$D$3&"_"&ROW()-${L.firstRow - 1}-COUNTBLANK($D$${L.firstRow}:$D${r}))` }
      ws.getRow(r).getCell(L.groupCol).value = t.group
      ws.getRow(r).height = groupStyle.height ?? 20
      r++
    }
    lastGroup = t.group
    applyStyle(ws, r, caseStyle)
    const row = ws.getRow(r)
    const link = t.report ? relative(dirname(out), t.report).replace(/\\/g, '/') : undefined
    if (id === 'BES') {
      row.getCell(1).value = { formula: `IF($D${r}="","",$D$3&"_"&ROW()-${L.firstRow - 1}-COUNTBLANK($D$${L.firstRow}:$D${r}))` }
      row.getCell(2).value = t.purpose
      row.getCell(3).value = t.data ? `${t.steps}\nDữ liệu: ${t.data}` : t.steps
      row.getCell(4).value = t.expected
      t.results.slice(0, 3).forEach((v, k) => (row.getCell(5 + k).value = v))
      row.getCell(8).value = { formula: `IF(G${r}<>"",G${r},IF(F${r}<>"",F${r},E${r}))` }
      row.getCell(9).value = link ? { text: t.note || 'Báo cáo', hyperlink: link } : t.note || null
      row.height = heightFor([t.purpose, t.steps, t.expected], widths)
    } else {
      row.getCell(1).value = { formula: '$C$3' }
      row.getCell(2).value = t.purpose
      row.getCell(3).value = t.steps
      row.getCell(4).value = t.data ?? null
      row.getCell(5).value = t.expected
      row.getCell(6).value = (caseStyle.values[5] as string) ?? 'High'
      row.getCell(7).value = (caseStyle.values[6] as string) ?? null
      const h = row.getCell(8)
      h.value = finalOf(t.results) || null
      const tries = t.results.length > 1 ? `Các lần chạy: ${t.results.join(' → ')}\n` : ''
      if (t.note || tries || link) h.note = `${tries}${t.note}${link ? `\nBáo cáo: ${link}` : ''}`.trim()
      row.height = heightFor([t.purpose, t.steps, t.data ?? '', t.expected], widths)
    }
    r++
  }
  await wb.xlsx.writeFile(out)
  return id
}

/* ------------------------------------------------------------------- read */

export interface KbktRow {
  sheet: string
  row: number
  code: string
  group: string
  purpose: string
  steps: string
  expected: string
  /** Result already written in the file (final). */
  prev: string
}

/** Read every test-case row of every recognised sheet of a KBKT file. */
export async function readKbkt(path: string): Promise<{ layout: LayoutId; rows: KbktRow[] }> {
  const wb = await load(path)
  const rows: KbktRow[] = []
  let layout: LayoutId | null = null
  for (const ws of wb.worksheets) {
    const id = detectLayout(ws)
    if (!id) continue
    layout ??= id
    const L = LAYOUTS[id]
    const code = text(ws.getCell(L.meta.code))
    let group = ''
    for (let r = L.firstRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const c = (n: number): string => text(row.getCell(n))
      if (id === 'BES') {
        const [b, cc, d] = [c(2), c(3), c(4)]
        if (!b && !cc && !d) continue
        const merged = ws.getCell(`C${r}`).isMerged && ws.getCell(`B${r}`).isMerged
        // Group rows: merged B:C, or a label alone in B (sub-group rows aren't always merged).
        if (b && !d && (merged || !cc || b === cc)) {
          group = b
          continue
        }
        if (!d && !cc) continue
        rows.push({ sheet: ws.name, row: r, code: c(1) || `${code}_${rows.length + 1}`, group, purpose: b, steps: cc, expected: d, prev: c(8) || c(7) || c(6) || c(5) })
      } else {
        const [a, b, cc, e] = [c(1), c(2), c(3), c(5)]
        if (!a && !b && !cc) continue
        if (ws.getCell(`B${r}`).isMerged && ws.getCell(`A${r}`).isMerged && (!b || b === a) && (!cc || cc === a)) {
          group = a
          continue
        }
        if (!b && !cc) continue
        rows.push({ sheet: ws.name, row: r, code: a || code, group, purpose: b, steps: cc, expected: e, prev: c(8) })
      }
    }
  }
  if (!layout) throw new Error('Không thấy sheet nào đúng mẫu KBKT (BES hoặc BCCS) trong file này')
  return { layout, rows }
}

/* -------------------------------------------------------------- write back */

export interface KbktResult {
  sheet: string
  row: number
  results: ('P' | 'F' | 'PE')[]
  note: string
  report?: string
}

/**
 * Copy the tester's KBKT file to `out`, writing results into the given rows only —
 * everything else (their wording, formatting, other sheets) is kept.
 */
export async function writeBack(src: string, out: string, results: KbktResult[]): Promise<number> {
  const wb = await load(src)
  wb.calcProperties.fullCalcOnLoad = true
  let n = 0
  for (const res of results) {
    const ws = wb.getWorksheet(res.sheet)
    if (!ws) continue
    const id = detectLayout(ws)
    if (!id) continue
    const row = ws.getRow(res.row)
    const link = res.report ? relative(dirname(out), res.report).replace(/\\/g, '/') : undefined
    if (id === 'BES') {
      for (let k = 0; k < 3; k++) row.getCell(5 + k).value = res.results[k] ?? null
      row.getCell(9).value = link ? { text: res.note || 'Báo cáo', hyperlink: link } : res.note || row.getCell(9).value
    } else {
      const h = row.getCell(8)
      h.value = finalOf(res.results) || null
      const tries = res.results.length > 1 ? `Các lần chạy: ${res.results.join(' → ')}\n` : ''
      if (res.note || tries || link) h.note = `${tries}${res.note}${link ? `\nBáo cáo: ${link}` : ''}`.trim()
    }
    n++
  }
  await wb.xlsx.writeFile(out)
  return n
}
