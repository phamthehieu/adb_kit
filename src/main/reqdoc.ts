import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import JSZip from 'jszip'
import { q, shell } from './adb'
import { dumpUi } from './ui'
import { evalIn, listWebViews } from './miniapp'
import { foregroundPackage } from './services'
import { writeKbkt } from './kbkt'
import {
  branchOf,
  fold,
  rulesOf,
  type ReqApi,
  type ReqCase,
  type ReqDoc,
  type ReqDocInfo,
  type ReqField,
  type ReqFlowRow,
  type ReqParam,
  type ReqScreen,
  type ReqStep,
  type ScanInput,
  type ScreenScan
} from '../shared/reqdoc'

/**
 * Parse BA requirement documents (.docx, TLNV / MTYCTD templates) into screens, APIs and
 * flows. Tables are recognised by their header row, not by position, so the variants of the
 * templates (Title/Component Type, Tên/Loại Control/Độ dài tối đa/Read only, Tham số/Kiểu
 * dữ liệu, Danh mục/Nội dung chi tiết, Step/Description…) all land in the same model.
 */

/* ------------------------------------------------------------------ xml helpers */

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m)
  )

/** Direct children <w:tag> of xml (depth-aware: nested tables keep their own rows/cells). */
function children(xml: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<w:${tag}(?=[ >/])[^>]*?(/?)>|</w:${tag}>`, 'g')
  let depth = 0
  let start = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('</')) {
      if (--depth === 0 && start >= 0) out.push(xml.slice(start, re.lastIndex))
    } else if (m[1] === '/') {
      if (depth === 0) out.push(m[0])
    } else {
      if (depth++ === 0) start = m.index
    }
  }
  return out
}

/** Text of a paragraph: runs, tabs, breaks and Wingdings arrows (w:sym). */
function paraText(p: string): string {
  let s = ''
  for (const m of p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br(?: [^>]*)?\/>|<w:sym [^>]*\/>|<w:noBreakHyphen\/>/g)) {
    if (m[1] !== undefined) s += decode(m[1])
    else if (m[0] === '<w:tab/>') s += ' '
    else if (m[0].startsWith('<w:br')) s += '\n'
    else if (m[0].startsWith('<w:sym')) s += ' → '
    else s += '-'
  }
  return s.replace(/[ \t\u00a0]+/g, ' ').trim()
}

/** Text of a cell (paragraphs on separate lines, nested tables flattened). */
function cellText(tc: string): string {
  return [...tc.matchAll(/<w:p(?=[ >])[\s\S]*?<\/w:p>/g)]
    .map((p) => paraText(p[0]))
    .filter(Boolean)
    .join('\n')
}

const imagesIn = (xml: string): string[] => [...xml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)].map((m) => m[1])

interface Cell {
  text: string
  span: number
  /** vMerge continuation (empty, merged with the cell above). */
  cont: boolean
}

function tableRows(tbl: string): Cell[][] {
  return children(tbl, 'tr').map((tr) =>
    children(tr, 'tc').map((tc) => ({
      text: cellText(tc),
      span: Number(/<w:gridSpan w:val="(\d+)"/.exec(tc)?.[1] ?? 1),
      cont: /<w:vMerge\/>|<w:vMerge w:val="continue"\/>/.test(tc)
    }))
  )
}

/** Row cells laid out on the grid (gridSpan repeated as empty cells) so columns line up. */
const onGrid = (row: Cell[]): string[] => row.flatMap((c) => [c.cont ? '' : c.text, ...Array<string>(Math.max(0, c.span - 1)).fill('')])

/* ------------------------------------------------------------------ headings */

const GENERIC = new RegExp(
  '^(' +
    [
      'thay doi (ve )?(giao dien|nghiep vu)',
      '(mo ta|thiet ke|dac ta)( chi tiet)?( cac)?( thanh phan| truong)?( tren)?( man hinh| giao dien| chuc nang| api)?',
      'input|output|request|response|tham so( dau vao| dau ra)?|dau vao|dau ra|ma loi|ket qua tra ve',
      'xu ly( luong)?( su kien)?( tuong tac)?',
      'luong xu ly',
      'mapping api',
      'doi tuong bi tac dong',
      'giao dien',
      'chi tiet cac chuc nang( thay doi)?',
      'noi dung thay doi',
      'dac ta api',
      'chuc nang',
      'api',
      'danh sach api',
      'thong tin chung',
      'validate|kiem tra du lieu'
    ].join('|') +
    ')$'
)
const BLOCK = /^(block|header|footer|khu vuc|vung|phan)\b|\bblock\b/

const plainHeading = (h: string): string => fold(h.replace(/^[\dIVX]+(\.[\d]+)*\.?\s+/, ''))

/** The heading a table belongs to: deepest heading that is neither generic nor a block. */
function ownerOf(path: string[]): { idx: number; section?: string } {
  let section: string | undefined
  for (let i = path.length - 1; i >= 0; i--) {
    const h = plainHeading(path[i])
    if (!h || GENERIC.test(h)) continue
    if (BLOCK.test(h) && i > 0) {
      section ??= path[i]
      continue
    }
    return { idx: i, section }
  }
  return { idx: path.length - 1, section }
}

/* ------------------------------------------------------------------ table kinds */

type Kind = 'fields' | 'params' | 'danhmuc' | 'steps' | 'codes' | 'curl' | 'meta' | 'history' | 'other'

function kindOf(head: string[], rows: string[][]): Kind {
  const h = head.map(fold)
  const has = (re: RegExp): boolean => h.some((x) => re.test(x))
  if (h.length === 1 && /^curl\b/i.test((rows[0]?.[0] ?? head[0]).trim())) return 'curl'
  if (has(/ngay thay doi|vi tri thay doi/)) return 'history'
  if (has(/loai control|component type|loai thanh phan/) || (has(/^title$/) && has(/mandatory|editable/))) return 'fields'
  if (h[0] === 'danh muc' || rows.slice(1).some((r) => /^(muc dich|xu ly)$/.test(fold(r[0] ?? '')))) return 'danhmuc'
  if (has(/status code|^ma loi$|http code/)) return 'codes'
  if (h.length <= 3 && rows.some((r) => /^(url|uri|endpoint|method|phuong thuc|duong dan|contenttype|content type)$/.test(fold(r[0] ?? '')))) return 'meta'
  if (has(/^(tham so|thuoc tinh|parameter|param|truong|ten truong|field|key)$/) && has(/kieu du lieu|data ?type|^type$|^kieu$/)) return 'params'
  if ((has(/^(step|buoc)$/) && has(/^(description|desciption|xu ly|mo ta)$/)) || (h[0] === 'buoc' && h.length === 2)) return 'steps'
  return 'other'
}

const bool = (s: string | undefined): boolean | null => {
  const v = fold(s ?? '')
  if (/^(yes|y|x|co|true|c|bat buoc)$/.test(v)) return true
  if (/^(no|n|khong|false|k)$/.test(v)) return false
  return null
}

function col(head: string[], re: RegExp): number {
  return head.map(fold).findIndex((x) => re.test(x))
}

function parseFields(head: string[], rows: string[][], section: string | undefined): ReqField[] {
  const iNo = col(head, /^(#|stt|no|tt)$/)
  const iTitle = col(head, /^(title|ten|ten truong|truong|ten control|thanh phan|ten thanh phan|label|nhan)$/)
  const iType = col(head, /component|loai control|loai thanh phan|^kieu/)
  const iEdit = col(head, /editable|cho phep sua/)
  const iRo = col(head, /read ?only|chi doc/)
  const iMand = col(head, /mandatory|bat buoc|required/)
  const iMax = col(head, /do dai|max ?length/)
  const iData = col(head, /chuan bi du lieu|du lieu mau|test data/)
  const iDesc = col(head, /description|mo ta|ghi chu/)
  const out: ReqField[] = []
  let sec = section
  for (const r of rows) {
    const filled = r.filter((c) => c.trim())
    // Section row: one merged cell ("I. Thông tin khách hàng").
    if (filled.length === 1 && (r[iTitle] ?? '').trim() === '' && (r[iType] ?? '').trim() === '') {
      sec = filled[0].split('\n')[0].slice(0, 120)
      continue
    }
    if (!filled.length) continue
    const editable = iEdit >= 0 ? bool(r[iEdit]) : iRo >= 0 ? (bool(r[iRo]) === true ? false : null) : null
    const base = {
      no: (r[iNo] ?? '').trim(),
      title: (r[iTitle] ?? '').replace(/\n/g, ' ').trim(),
      type: (r[iType] ?? '').replace(/\n/g, ' ').trim(),
      editable,
      mandatory: iMand >= 0 ? bool(r[iMand]) : null,
      desc: (r[iDesc] ?? '').trim(),
      section: sec,
      data: iData >= 0 ? (r[iData] ?? '').trim() || undefined : undefined
    }
    out.push({ ...base, rules: rulesOf(base, iMax >= 0 ? r[iMax] : undefined) })
  }
  return out
}

function parseParams(head: string[], rows: string[][]): { inputs: boolean; params: ReqParam[] } {
  const iName = col(head, /^(tham so|thuoc tinh|parameter|param|truong|ten truong|field|key)$/)
  const iType = col(head, /kieu du lieu|data ?type|^type$|^kieu$/)
  const iReq = col(head, /bat buoc|required|mandatory/)
  const iDesc = col(head, /mo ta|description/)
  const iMap = col(head, /^map/)
  const mapHead = iMap >= 0 ? fold(head[iMap]) : ''
  const inputs = /truyen|dau vao|request/.test(mapHead) || (iReq >= 0 && !/giao dien/.test(mapHead))
  const params: ReqParam[] = []
  for (const r of rows) {
    const name = (r[iName] ?? '').split('\n')[0].trim()
    if (!name || r.filter((c) => c.trim()).length === 1) continue // section row ("lstProductDTO <Array>: …")
    params.push({
      name: name.slice(0, 120),
      type: (r[iType] ?? '').trim() || undefined,
      required: iReq >= 0 ? bool(r[iReq]) === true : false,
      desc: (r[iDesc] ?? '').trim(),
      map: iMap >= 0 ? (r[iMap] ?? '').trim() || undefined : undefined
    })
  }
  return { inputs, params }
}

function parseSteps(text: string): ReqStep[] {
  const steps: ReqStep[] = []
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    if (!l) continue
    const m = /^(?:bước|step|b)\s*(\d+)\s*[:.)-]?\s*(.*)$/i.exec(l)
    if (m) {
      steps.push({ no: Number(m[1]), text: m[2], branches: [] })
      continue
    }
    if (!steps.length) steps.push({ no: 1, text: '', branches: [] })
    const cur = steps[steps.length - 1]
    const b = branchOf(l)
    if (b) cur.branches.push(b)
    else if (cur.branches.length) cur.branches[cur.branches.length - 1].action += ` ${l}`
    else cur.text += (cur.text ? ' ' : '') + l
  }
  return steps
}

/** TLNV "Input" lines → params ("Từ ngày (*), Đến ngày (*): khoảng thời gian tra cứu."). */
function inputsOf(text: string): ReqParam[] {
  const out: ReqParam[] = []
  for (const l of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const [names, ...rest] = l.split(/:\s/)
    const desc = rest.join(': ').trim()
    for (const part of (names.length <= 120 ? names : names.slice(0, 120)).split(/,\s*/)) {
      const name = part.replace(/\(\*\)/g, '').replace(/[.;]$/, '').trim()
      if (name) out.push({ name, required: /\(\*\)/.test(part), desc })
    }
  }
  return out
}

function curlOf(text: string): { method?: string; url?: string } {
  const url = /(https?:\/\/[^\s'"\\]+)/.exec(text)?.[1]
  const method = /(?:-X|--request)\s+'?(\w+)/.exec(text)?.[1]?.toUpperCase() ?? (/(--data|-d\s|--data-raw|--form|-F\s)/.test(text) ? 'POST' : 'GET')
  // Path only: hosts / query strings may carry environment details or keys.
  if (!url) return {}
  try {
    const u = new URL(url)
    return { method, url: u.pathname }
  } catch {
    return { method }
  }
}

/* ------------------------------------------------------------------ parse */

export async function parseDocx(buf: Buffer, file: string, mediaDir: string | null): Promise<ReqDoc> {
  const zip = await JSZip.loadAsync(buf)
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml) throw new Error('Không phải file Word (.docx) hợp lệ')
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
  const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''
  const rels = new Map([...relsXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2]]))
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)) rels.set(m[2], m[1])

  // Heading level per style id: name "heading N" or an outline level in the style.
  const levels = new Map<string, number>()
  for (const s of children(stylesXml, 'style')) {
    const id = /w:styleId="([^"]+)"/.exec(s)?.[1]
    const name = /<w:name w:val="([^"]+)"/.exec(s)?.[1] ?? ''
    if (!id || /toc|title|subtitle/i.test(name)) continue
    const n = /^heading\s*(\d)$/i.exec(name)?.[1] ?? (/<w:outlineLvl w:val="(\d)"/.exec(s)?.[1] !== undefined ? String(Number(/<w:outlineLvl w:val="(\d)"/.exec(s)![1]) + 1) : undefined)
    if (n) levels.set(id, Number(n))
  }

  const body = docXml.slice(docXml.indexOf('<w:body'))
  // Top-level blocks in order: paragraphs (also inside content controls) and tables.
  const blocks: { k: 'p' | 't'; xml: string }[] = []
  const re = /<w:tbl>|<w:p(?=[ >])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (m[0] === '<w:tbl>') {
      const [t] = children(body.slice(m.index), 'tbl')
      blocks.push({ k: 't', xml: t })
      re.lastIndex = m.index + t.length
    } else {
      const end = body.indexOf('</w:p>', m.index)
      const selfClose = body.slice(m.index, body.indexOf('>', m.index) + 1).endsWith('/>')
      const stop = selfClose ? body.indexOf('>', m.index) + 1 : end + 6
      blocks.push({ k: 'p', xml: body.slice(m.index, stop) })
      re.lastIndex = stop
    }
  }

  const path: string[] = []
  const screens = new Map<string, ReqScreen>()
  const apis = new Map<string, ReqApi>()
  const images = new Map<string, string[]>()
  const notes: string[] = []
  const keyOf = (p: string[]): string => p.map(plainHeading).join(' > ')
  let ignored = 0
  const skippedHeads: string[] = []

  const screenFor = (ownerIdx: number): ReqScreen => {
    const p = path.slice(0, ownerIdx + 1)
    const key = keyOf(p)
    let s = screens.get(key)
    if (!s) {
      s = { id: `s${screens.size + 1}`, title: p[p.length - 1] ?? 'Màn hình', path: p, fields: [], flow: [], images: [] }
      screens.set(key, s)
    }
    return s
  }
  const apiFor = (ownerIdx: number): ReqApi => {
    const p = path.slice(0, ownerIdx + 1)
    const key = keyOf(p)
    let a = apis.get(key)
    if (!a) {
      const name = (p[p.length - 1] ?? 'API').replace(/^Tích hợp lại\s+/i, '')
      const system = [...p].reverse().find((h) => /^he thong\b/.test(plainHeading(h)))
      const screen = [...p.slice(0, -1)].reverse().find((h) => /^(man hinh|popup|bottom ?sheet|buoc \d)/.test(plainHeading(h)))
      a = { id: `a${apis.size + 1}`, name, system, screen, purpose: '', inputs: [], outputs: [], outputText: '', steps: [], codes: [] }
      apis.set(key, a)
    }
    return a
  }

  for (const b of blocks) {
    if (b.k === 'p') {
      const st = /<w:pStyle w:val="([^"]+)"/.exec(b.xml)?.[1]
      const own = /<w:outlineLvl w:val="(\d)"/.exec(b.xml)?.[1]
      const lvl = (st && levels.get(st)) || (own !== undefined ? Number(own) + 1 : 0)
      const text = paraText(b.xml).replace(/\n/g, ' ')
      if (lvl && lvl <= 6 && text && !/^m[uụ]c l[uụ]c$/i.test(text)) {
        // Truncate to the parent level; a skipped level (H1 → H3) leaves an empty slot.
        if (path.length > lvl - 1) path.length = lvl - 1
        while (path.length < lvl - 1) path.push('')
        path[lvl - 1] = text
        continue
      }
      for (const id of imagesIn(b.xml)) {
        const k = keyOf(path.slice(0, ownerOf(path).idx + 1))
        images.set(k, [...(images.get(k) ?? []), id])
      }
      // API details written as paragraphs ("URL: /api/…", "Method: POST").
      if (text && path.length) {
        const url = /^(?:url|endpoint|đường dẫn|path)\s*:\s*(\S+)/i.exec(text)?.[1]
        const meth = /^(?:method|phương thức)\s*:\s*(GET|POST|PUT|PATCH|DELETE)/i.exec(text)?.[1]
        if (url || meth) {
          const a = apiFor(ownerOf(path).idx)
          if (url) a.url = url.startsWith('http') ? curlOf(url).url : url
          if (meth) a.method = meth.toUpperCase()
        }
      }
      continue
    }
    const rows = tableRows(b.xml).map(onGrid)
    for (const id of imagesIn(b.xml)) {
      const k = keyOf(path.slice(0, ownerOf(path).idx + 1))
      images.set(k, [...(images.get(k) ?? []), id])
    }
    if (!rows.length) continue
    const head = rows[0].map((c) => c.replace(/\n/g, ' '))
    const kind = kindOf(head, rows)
    const owner = ownerOf(path)
    switch (kind) {
      case 'fields': {
        const s = screenFor(owner.idx)
        s.fields.push(...parseFields(head, rows.slice(1), owner.section))
        break
      }
      case 'steps': {
        const iDesc = col(head, /^(description|desciption|xu ly|mo ta)$/)
        const iStep = col(head, /^(step|buoc)$/)
        // Under an API heading the step table is the API's processing, not a screen flow.
        if (/(^|\] |\s)api\b/.test(plainHeading(path[owner.idx] ?? ''))) {
          const a = apiFor(owner.idx)
          const text = rows
            .slice(1)
            .map((r, i) => `Bước ${/^\d+$/.test((r[iStep >= 0 ? iStep : 0] ?? '').trim()) ? r[iStep >= 0 ? iStep : 0].trim() : a.steps.length + i + 1}: ${(r[iDesc >= 0 ? iDesc : 1] ?? '').trim()}`)
            .join('\n')
          a.steps.push(...parseSteps(text))
          break
        }
        const s = screenFor(owner.idx)
        let sec: string | undefined = owner.section
        for (const r of rows.slice(1)) {
          const filled = r.filter((c) => c.trim())
          if (!filled.length) continue
          const text = (r[iDesc >= 0 ? iDesc : 1] ?? '').trim()
          if (filled.length === 1 && !text) {
            sec = filled[0].split('\n')[0]
            continue
          }
          const step = (r[iStep >= 0 ? iStep : 0] ?? '').trim()
          const row: ReqFlowRow = { section: sec, text: step && !/^\d+$/.test(step) ? `${step}: ${text}` : text }
          s.flow.push(row)
        }
        break
      }
      case 'params': {
        const a = apiFor(owner.idx)
        const p = parseParams(head, rows.slice(1))
        if (p.inputs) a.inputs.push(...p.params)
        else a.outputs.push(...p.params)
        break
      }
      case 'danhmuc': {
        const a = apiFor(owner.idx)
        for (const r of rows.slice(1)) {
          const k = fold(r[0] ?? '')
          const v = r.slice(1).filter(Boolean).join('\n').trim()
          if (/^muc dich/.test(k)) a.purpose = v
          else if (/^(input|dau vao|request)/.test(k)) a.inputs.push(...inputsOf(v))
          else if (/^(output|dau ra|response)/.test(k)) a.outputText = v
          else if (/^(xu ly|luong xu ly|processing)/.test(k)) a.steps.push(...parseSteps(v))
          else if (/^(url|endpoint)/.test(k)) a.url = v
          else if (/^method/.test(k)) a.method = v.toUpperCase()
        }
        break
      }
      case 'codes': {
        const a = apiFor(owner.idx)
        const iCode = col(head, /status code|ma loi|http code|^code$/)
        const iMsg = col(head, /message|mo ta|thong bao/)
        for (const r of rows.slice(1)) {
          const code = (r[iCode] ?? '').trim()
          if (code) a.codes.push({ code, message: (r[iMsg] ?? '').trim().slice(0, 300) })
        }
        break
      }
      case 'curl': {
        const a = apiFor(owner.idx)
        Object.assign(a, Object.fromEntries(Object.entries(curlOf(rows.map((r) => r.join(' ')).join('\n'))).filter(([, v]) => v)))
        break
      }
      case 'meta': {
        const a = apiFor(owner.idx)
        for (const r of [rows[0], ...rows.slice(1)]) {
          const k = fold(r[0] ?? '')
          const v = r.slice(1).find((c) => c.trim())?.trim() ?? ''
          if (/^(url|uri|endpoint|duong dan)$/.test(k) && v) a.url = /^https?:/.test(v) ? (curlOf(v).url ?? v) : v.split('?')[0]
          else if (/^(method|phuong thuc)$/.test(k) && /^(GET|POST|PUT|PATCH|DELETE)\b/i.test(v)) a.method = v.toUpperCase().split(/\s/)[0]
        }
        break
      }
      case 'history':
        break
      default:
        if (rows.length > 1 && head.some((c) => c.trim())) {
          ignored++
          const h = head.filter((c) => c.trim()).slice(0, 4).join(' | ').slice(0, 80)
          if (!skippedHeads.includes(h)) skippedHeads.push(h)
        }
    }
  }
  if (ignored) notes.push(`Bỏ qua ${ignored} bảng không phải bảng màn hình / API / luồng (${skippedHeads.slice(0, 5).map((h) => `“${h}”`).join(', ')})`)

  // Mockup images of each screen, copied out of the document.
  const usable = /\.(png|jpe?g|gif|webp)$/i
  let saved = 0
  for (const [key, s] of screens) {
    const ids = [...new Set(images.get(key) ?? [])]
    for (const id of ids.slice(0, 6)) {
      const target = rels.get(id)
      if (!target || !usable.test(target) || !mediaDir || saved >= 120) continue
      const entry = zip.file(`word/${target.replace(/^\.?\//, '')}`)
      if (!entry) continue
      const data = await entry.async('nodebuffer')
      if (data.length > 6 * 1024 * 1024) continue
      mkdirSync(mediaDir, { recursive: true })
      const name = `${s.id}_${basename(target)}`
      writeFileSync(join(mediaDir, name), data)
      s.images.push(name)
      saved++
    }
  }

  const coreXml = (await zip.file('docProps/core.xml')?.async('string')) ?? ''
  const coreTitle = decode(/<dc:title>([^<]*)<\/dc:title>/.exec(coreXml)?.[1] ?? '').trim()
  const stem = file.replace(/\.docx$/i, '').replace(/\s*\(\d+\)/g, '')
  const kind = /^(TLGP|TLNV|MTYCTĐ|MTYCTD|MTYC)/i.exec(stem)?.[1]?.toUpperCase() ?? 'DOC'
  const code = /(\d{5,6})/.exec(stem)?.[1] ?? ''
  const title =
    coreTitle && coreTitle.length > 8 && !/^(tài liệu|document|microsoft)/i.test(coreTitle)
      ? coreTitle
      : stem
          .replace(/^(TLGP|TLNV|MTYCTĐ|MTYCTD|MTYC)[_\s-]*/i, '')
          // Prefixes before the real title: team / author / "PYC 83124" / version suffix.
          .replace(/^((FE|BE|VTT|PMVT|QT\d+|CA|[A-Z][a-z]+[A-Z]{2,})[_\s-]+)+/, '')
          .replace(/^(PYC[_\s-]*)?\d{4,6}[_\s-]+(PYC[_\s-]+)?/i, '')
          .replace(/[_\s-]+v\d+(\.\d+)*(-\d+)?$/i, '')
          .replace(/_/g, ' ')
          .trim()

  const list = [...screens.values()].filter((s) => s.fields.length || s.flow.length)
  // Same title twice (Android / iOS, cá nhân / doanh nghiệp…): add the closest differing ancestor.
  const count = new Map<string, number>()
  for (const s of list) count.set(fold(s.title), (count.get(fold(s.title)) ?? 0) + 1)
  const titled = list.map((s) => {
    if ((count.get(fold(s.title)) ?? 0) < 2) return s.title
    const same = list.filter((o) => fold(o.title) === fold(s.title))
    // Ancestors not shared by every copy tell the copies apart (e.g. "App iOS / KH doanh nghiệp").
    const diff = s.path.slice(0, -1).filter((h) => h && !GENERIC.test(plainHeading(h)) && !same.every((o) => o.path.includes(h)))
    return diff.length ? `${s.title} (${diff.join(' / ')})` : s.title
  })
  list.forEach((s, i) => (s.title = titled[i]))
  return {
    id: '',
    file,
    kind,
    code,
    title: title || stem,
    importedAt: Date.now(),
    screens: list.map((s, i) => ({ ...s, id: `s${i + 1}` })),
    apis: [...apis.values()].filter((a) => a.inputs.length || a.outputs.length || a.steps.length || a.purpose || a.url),
    notes
  }
}

/* ------------------------------------------------------------------ store */

export class ReqDocStore {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error('mã tài liệu không hợp lệ')
    return join(this.root, id)
  }

  async import(path: string): Promise<ReqDoc> {
    const file = basename(path)
    if (extname(file).toLowerCase() !== '.docx') throw new Error('Chỉ hỗ trợ file Word .docx (file .doc cũ: mở bằng Word rồi Lưu thành .docx)')
    const id = `${(/(\d{5,6})/.exec(file)?.[1] ?? 'doc')}-${Date.now().toString(36)}`
    const dir = this.dir(id)
    try {
      const doc = await parseDocx(readFileSync(path), file, join(dir, 'media'))
      doc.id = id
      if (!doc.screens.length && !doc.apis.length) throw new Error('Không tìm thấy bảng mô tả màn hình hay API nào trong tài liệu')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
      return doc
    } catch (e) {
      rmSync(dir, { recursive: true, force: true })
      throw e
    }
  }

  list(): ReqDocInfo[] {
    if (!existsSync(this.root)) return []
    const out: ReqDocInfo[] = []
    for (const id of readdirSync(this.root)) {
      try {
        const d = JSON.parse(readFileSync(join(this.root, id, 'doc.json'), 'utf8')) as ReqDoc
        out.push({ id: d.id, file: d.file, title: d.title, code: d.code, screens: d.screens.length, apis: d.apis.length, importedAt: d.importedAt })
      } catch {
        /* not a document folder */
      }
    }
    return out.sort((a, b) => b.importedAt - a.importedAt)
  }

  get(id: string): ReqDoc {
    return JSON.parse(readFileSync(join(this.dir(id), 'doc.json'), 'utf8')) as ReqDoc
  }

  remove(id: string): void {
    rmSync(this.dir(id), { recursive: true, force: true })
  }

  image(id: string, name: string): string {
    if (!/^[\w.-]+$/.test(name)) throw new Error('tên ảnh không hợp lệ')
    const data = readFileSync(join(this.dir(id), 'media', name))
    const ext = extname(name).slice(1).toLowerCase()
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${data.toString('base64')}`
  }
}

/* ------------------------------------------------------------------ KBKT */

export async function exportCases(
  cases: ReqCase[],
  out: string,
  template: string,
  meta: { title: string; code: string; author: string; tester: string }
): Promise<string> {
  await writeKbkt(template, out, {
    title: meta.title,
    code: meta.code || 'TC',
    author: meta.author,
    tester: meta.tester,
    cases: cases.map((c) => ({ group: c.group, purpose: c.purpose, steps: c.steps, data: c.data, expected: c.expected, results: [], note: '' }))
  })
  return out
}

/* ------------------------------------------------------------------ device */

/** Read in WebView pages: visible text and form inputs (labels, limits, state — never values). */
export const SCAN_JS = `(() => {
  if (document.hidden) return null
  const vis = (el) => { const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' }
  const near = (el) => {
    let l = (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('aria-label') || ''
    let p = el.parentElement
    for (let i = 0; i < 4 && p && !l; i++, p = p.parentElement) {
      const t = (p.innerText || '').trim().split('\\n')[0]
      if (t && t.length < 90) l = t
    }
    return (l || '').trim().slice(0, 120)
  }
  const inputs = [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
    .filter((e) => !['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(e.type) && vis(e))
    .slice(0, 120)
    .map((e) => ({ label: near(e), placeholder: e.placeholder || '', maxLength: typeof e.maxLength === 'number' && e.maxLength >= 0 ? e.maxLength : null,
      disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true', readOnly: !!e.readOnly, type: (e.type || e.tagName).toLowerCase() }))
  return { url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 30000), inputs }
})()`

/** What the phone shows now: native UI texts / inputs plus WebView (miniapp) pages of the foreground app. */
export async function scanScreen(serial: string): Promise<ScreenScan> {
  const pkg = (await foregroundPackage(serial)) ?? ''
  const scan: ScreenScan = { pkg, texts: [], inputs: [], pages: [], notes: [] }
  await Promise.all([
    (async () => {
      try {
        const ui = await dumpUi(serial)
        for (const n of ui.nodes) {
          if (n.text) scan.texts.push(n.text)
          if (n.desc) scan.texts.push(n.desc)
          if (/EditText|AutoComplete/.test(n.cls)) scan.inputs.push({ label: n.text || n.desc, placeholder: '', maxLength: null, disabled: n.enabled === false, readOnly: false, type: 'edittext', source: 'native' })
        }
      } catch (e) {
        scan.notes.push(`Không đọc được giao diện native: ${(e as Error).message}`)
      }
    })(),
    (async () => {
      try {
        const procs = (await listWebViews(serial)).filter((p) => !pkg || p.pkg === pkg || p.pkg.startsWith(`${pkg}:`))
        for (const p of procs) {
          for (const page of p.pages.filter((x) => x.visible !== false).slice(0, 6)) {
            const r = (await evalIn(serial, p.socket, page.id, SCAN_JS).catch(() => null)) as { url: string; text: string; inputs: Omit<ScanInput, 'source'>[] } | null
            if (!r) continue
            scan.pages.push(r.url)
            scan.texts.push(...r.text.split('\n').map((t) => t.trim()).filter(Boolean))
            scan.inputs.push(...r.inputs.map((i) => ({ ...i, source: 'webview' as const })))
          }
        }
        if (!procs.length) scan.notes.push('App không mở WebView gỡ lỗi được – chỉ soát phần native (miniapp cần bản staging / debug)')
      } catch (e) {
        scan.notes.push(`Không đọc được WebView: ${(e as Error).message}`)
      }
    })()
  ])
  return scan
}

/**
 * Type a value into the phone: in a WebView, into the input labelled like `label` (or the
 * focused one) with the native setter + input/change/blur events so React/Vue validation runs;
 * otherwise through the soft keyboard (adb input text: ASCII only).
 */
export async function fillValue(serial: string, value: string, label?: string): Promise<string> {
  const pkg = (await foregroundPackage(serial)) ?? ''
  const js = fillJs(value, label)
  try {
    const procs = (await listWebViews(serial)).filter((p) => !pkg || p.pkg === pkg || p.pkg.startsWith(`${pkg}:`))
    for (const p of procs) {
      for (const page of p.pages.filter((x) => x.visible !== false)) {
        const r = (await evalIn(serial, p.socket, page.id, js).catch(() => null)) as { label: string; length: number; maxLength: number; locked?: boolean } | null
        if (r?.locked) return `Ô “${r.label}” đang bị khoá (disabled / readonly) – không điền được`
        if (r) {
          const cut = r.length < value.length ? ` – ô chỉ nhận ${r.length}/${value.length} ký tự` : ''
          return `Đã điền vào ô WebView “${r.label || 'đang chọn'}”${cut}`
        }
      }
    }
  } catch {
    /* fall back to the keyboard */
  }
  if (/[^\x20-\x7e]/.test(value)) throw new Error('Không tìm thấy ô nhập trong WebView. Bàn phím ảo (adb) chỉ gõ được ký tự không dấu – hãy chạm vào ô cần điền rồi thử lại, hoặc dùng giá trị không dấu.')
  if (value === '') return 'Giá trị rỗng: hãy xoá nội dung ô trên điện thoại'
  await shell(serial, `input text ${q(value.replace(/ /g, '%s'))}`)
  return 'Đã gõ vào ô đang chọn trên điện thoại (bàn phím ảo)'
}

/** Page script for fillValue (exported for tests). */
export function fillJs(value: string, label?: string): string {
  return `((v, want) => {
    const fold = (s) => (s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\\s+/g, ' ').trim()
    // Every name an input goes by: <label>, aria-label, placeholder, first line of nearby text.
    const names = (el) => {
      const out = [(el.labels && el.labels[0] && el.labels[0].innerText) || '', el.getAttribute('aria-label') || '', el.placeholder || '']
      let p = el.parentElement
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) { const t = (p.innerText || '').trim().split('\\n')[0]; if (t && t.length < 90) { out.push(t); break } }
      return out.map(fold).filter(Boolean)
    }
    const near = (el) => names(el)[0] || ''
    const w = fold(want)
    const hit = (e) => w && names(e).some((n) => n.includes(w) || (n.length > 3 && w.includes(n)))
    const boxes = [...document.querySelectorAll('input, textarea')].filter((e) => !['hidden','checkbox','radio','file','submit','button'].includes(e.type) && e.getBoundingClientRect().width > 0)
    const all = boxes.filter((e) => !e.disabled && !e.readOnly)
    let el = all.find(hit) || null
    if (!el) { const locked = boxes.find((e) => (e.disabled || e.readOnly) && hit(e)); if (locked) return { label: near(locked), locked: true, length: 0, maxLength: -1 } }
    if (!el && document.activeElement && all.includes(document.activeElement)) el = document.activeElement
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    el.focus()
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    // A script-set value skips maxlength; cut it like typing would so limits are tested honestly.
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, el.maxLength >= 0 ? v.slice(0, el.maxLength) : v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur()
    el.dispatchEvent(new Event('focusout', { bubbles: true }))
    return { label: near(el), length: el.value.length, maxLength: el.maxLength }
  })(${JSON.stringify(value)}, ${JSON.stringify(label ?? '')})`
}
