/**
 * BA requirement documents (TLNV / MTYCTD .docx) turned into a tree of screens, APIs and
 * flows, plus everything derived from it without a device: field rules, boundary values,
 * test cases and matching a scanned phone screen against a documented one.
 */

/* ------------------------------------------------------------------ model */

export type FieldRule =
  | { kind: 'maxLen'; n: number }
  | { kind: 'minLen'; n: number }
  | { kind: 'date'; fmt: string }
  | { kind: 'email' }
  | { kind: 'phone' }
  | { kind: 'digits' }
  | { kind: 'noSpecial' }
  | { kind: 'disabled' }
  | { kind: 'options'; values: string[] }
  | { kind: 'default'; value: string }
  | { kind: 'api'; name: string }

export interface ReqField {
  no: string
  title: string
  type: string
  /** true / false / null (not stated). */
  editable: boolean | null
  mandatory: boolean | null
  desc: string
  /** Sub-block of the screen (section row in the table or a deeper heading). */
  section?: string
  /** Test data the document asks to prepare (SME template). */
  data?: string
  rules: FieldRule[]
}

export interface ReqScreen {
  id: string
  title: string
  /** Heading chain, outermost first. */
  path: string[]
  fields: ReqField[]
  /** Event-handling / step tables of the screen: one line per row. */
  flow: ReqFlowRow[]
  /** Mockup images (paths in the document store). */
  images: string[]
}

export interface ReqFlowRow {
  section?: string
  text: string
}

export interface ReqParam {
  name: string
  type?: string
  required: boolean
  desc: string
  /** "Map dữ liệu truyền vào" / "Map giao diện". */
  map?: string
}

export interface ReqStep {
  no: number
  text: string
  branches: { cond: string; action: string }[]
}

export interface ReqApi {
  id: string
  name: string
  /** Owning system (heading above the API in TLNV: "Hệ thống CA/ MySign"). */
  system?: string
  /** Screen whose section the API is described in (MTYCTD "Mapping API"). */
  screen?: string
  method?: string
  url?: string
  purpose: string
  inputs: ReqParam[]
  outputs: ReqParam[]
  /** Free-text output (TLNV "Output" row). */
  outputText: string
  steps: ReqStep[]
  /** Status code / message rows. */
  codes: { code: string; message: string }[]
}

export interface ReqDoc {
  id: string
  /** Original file name. */
  file: string
  /** "TLNV" | "MTYCTD" | … taken from the file name. */
  kind: string
  /** Request number (PYC), e.g. 85714. */
  code: string
  title: string
  importedAt: number
  screens: ReqScreen[]
  apis: ReqApi[]
  /** Parser notes: tables it could not place, etc. */
  notes: string[]
}

export interface ReqDocInfo {
  id: string
  file: string
  title: string
  code: string
  screens: number
  apis: number
  importedAt: number
}

/* ------------------------------------------------------------------ text helpers */

/** Lower-case, no Vietnamese diacritics, single spaces: for fuzzy matching. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[“”"'‘’*:().,;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const lines = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** Quoted values “A” "B" in a text. */
const quoted = (s: string): string[] => [...s.matchAll(/[“"]([^”"]{1,80})[”"]/g)].map((m) => m[1].trim()).filter(Boolean)

/* ------------------------------------------------------------------ rules */

/** Description explicitly allows editing (overrides an "Editable: No" column). */
export const allowsEdit = (foldedDesc: string): boolean =>
  /cho phep (nhap|chinh sua|sua)/.test(foldedDesc) && !/khong cho phep (nhap|chinh sua|sua)/.test(foldedDesc)

/** Short API name: the {…} part of "API_MySign {API khởi tạo …} cho Miniapp". */
export const shortApi = (name: string): string => /\{([^}]{4,})\}/.exec(name)?.[1].trim() ?? name

/** Contradictions inside one field row, worth asking the BA about. */
export function fieldWarnings(f: ReqField): string[] {
  const d = fold(f.desc)
  const out: string[] = []
  if (f.editable === false && allowsEdit(d) && !/khong cho phep/.test(d)) out.push('Cột Editable = No nhưng mô tả ghi "cho phép chỉnh sửa"')
  if (f.editable === true && /khong cho phep chinh sua|^disable,/.test(d)) out.push('Cột Editable = Yes nhưng mô tả ghi "không cho phép chỉnh sửa"')
  const max = f.rules.filter((r) => r.kind === 'maxLen')
  if (max.length > 1) out.push(`Có nhiều giới hạn độ dài khác nhau: ${max.map((r) => (r as { n: number }).n).join(' / ')}`)
  return out
}

/** Rules a field description implies (plus the type / title / explicit columns). */
export function rulesOf(f: Omit<ReqField, 'rules'>, maxLenCol?: string): FieldRule[] {
  const out: FieldRule[] = []
  const d = fold(f.desc)
  const t = fold(f.title)
  const ty = fold(f.type)
  const col = parseInt((maxLenCol ?? '').replace(/\D+/g, ''), 10)
  const max = col > 0 ? col : Number(/(?:toi da|khong vuot qua|khong qua|max(?:imum)?(?: length)?)\s*(\d{1,5})\s*(?:ky tu|chu so|so|characters?|chars?)?/.exec(d)?.[1] ?? 0)
  if (max > 0) out.push({ kind: 'maxLen', n: max })
  const min = Number(/(?:toi thieu|it nhat|min(?:imum)?)\s*(\d{1,4})\s*(?:ky tu|chu so|characters?)/.exec(d)?.[1] ?? 0)
  if (min > 0) out.push({ kind: 'minLen', n: min })
  const fmt = /(dd\s*[/-]\s*mm\s*[/-]\s*yyyy(?:\s*hh:mm(?::ss)?)?|mm\s*[/-]\s*yyyy|yyyy\s*-\s*mm\s*-\s*dd)/i.exec(f.desc)?.[1]
  if (fmt) out.push({ kind: 'date', fmt: fmt.replace(/\s+/g, '').replace(/^dd/i, 'dd').replace(/mm/i, 'MM').replace(/yyyy/i, 'yyyy') })
  else if (/date|ngay/.test(ty) || /^ngay /.test(t)) out.push({ kind: 'date', fmt: 'dd/MM/yyyy' })
  if (/email/.test(t) || /dinh dang email/.test(d)) out.push({ kind: 'email' })
  if (/(so dien thoai|sdt|so lien he|di dong|phone|so thue bao|isdn|msisdn)/.test(t) && !/tai khoan/.test(t)) out.push({ kind: 'phone' })
  else if (
    /(chi (cho phep )?nhap so|chi gom so|chi chua so|kieu so|numeric)/.test(d) ||
    /^(number|numeric|so)$/.test(ty) ||
    /^(so (cccd|cmnd|can cuoc|dinh danh)|ma so thue|mst|ma otp|otp)\b/.test(t)
  ) {
    if (!/(dropdown|select|label|image|button)/.test(ty)) out.push({ kind: 'digits' })
  }
  if (/(khong (cho phep )?(nhap )?ky tu dac biet|khong chua ky tu dac biet)/.test(d)) out.push({ kind: 'noSpecial' })
  if ((f.editable === false && !allowsEdit(d)) || /^disable,|^disable |khong cho phep chinh sua|read ?only/.test(d)) out.push({ kind: 'disabled' })
  const opt = /(gom|bao gom|cac gia tri|gia tri)\s/.test(d) ? [...new Map(quoted(f.desc).map((x) => [fold(x), x])).values()] : []
  if (opt.length >= 2 && /(radio|dropdown|select|combo|tab|checkbox|segment)/.test(ty)) out.push({ kind: 'options', values: opt })
  const def = /mac dinh(?: vao man hinh)?(?: chon| la|:)?\s*[“"]([^”"]+)[”"]/.exec(f.desc.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'))
  if (def) {
    // Keep the original (accented) text: find the quote at the same index.
    const all = quoted(f.desc)
    const plain = all.find((q) => fold(q) === fold(def[1]))
    out.push({ kind: 'default', value: plain ?? def[1] })
  }
  for (const m of f.desc.matchAll(/(API_[\w]+\s*\{[^}]+\}|API\s+[\w./-]+(?:-v\d+)?)/g)) out.push({ kind: 'api', name: m[1].trim() })
  return out
}

export const ruleLabel = (r: FieldRule): string => {
  switch (r.kind) {
    case 'maxLen': return `≤ ${r.n} ký tự`
    case 'minLen': return `≥ ${r.n} ký tự`
    case 'date': return r.fmt
    case 'email': return 'email'
    case 'phone': return 'SĐT'
    case 'digits': return 'chỉ số'
    case 'noSpecial': return 'không ký tự đặc biệt'
    case 'disabled': return 'không sửa'
    case 'options': return `${r.values.length} lựa chọn`
    case 'default': return `mặc định “${r.value}”`
    case 'api': return 'gọi API'
  }
}

/* ------------------------------------------------------------------ boundary values */

export interface Probe {
  label: string
  value: string
  /** What the document says should happen. */
  expect: 'ok' | 'err'
}

/** A box the user types into (not a static "Text" label, button or image). */
export function isInput(f: Pick<ReqField, 'type'>): boolean {
  const ty = fold(f.type)
  if (/(label|button|image|icon|camera|stepper|progress|summary|link)/.test(ty) && !/(input|box|field|area)/.test(ty)) return false
  return /(text ?box|text ?field|textarea|text area|input|edit|date|picker|search|o nhap|^number$|^numeric$|otp|address|combobox|autocomplete)/.test(ty)
}

const repeat = (pattern: string, n: number): string => pattern.repeat(Math.ceil(n / pattern.length)).slice(0, n)
const pad = (n: number): string => String(n).padStart(2, '0')

/** Values worth typing into a field to check its rules (edge of each limit, wrong formats). */
export function probesOf(f: ReqField, today = new Date()): Probe[] {
  if (f.rules.some((r) => r.kind === 'disabled')) return []
  if (!isInput(f)) return []
  const out: Probe[] = []
  const has = <K extends FieldRule['kind']>(k: K): Extract<FieldRule, { kind: K }> | undefined => f.rules.find((r) => r.kind === k) as Extract<FieldRule, { kind: K }> | undefined
  const numeric = !!(has('digits') || has('phone'))
  const max = has('maxLen')
  if (max && max.n <= 2000) {
    const pat = numeric ? '1234567890' : 'Abcdefghij'
    out.push({ label: `${max.n} ký tự (đúng giới hạn)`, value: repeat(pat, max.n), expect: 'ok' })
    out.push({ label: `${max.n + 1} ký tự (vượt 1)`, value: repeat(pat, max.n + 1), expect: 'err' })
  }
  const min = has('minLen')
  if (min && min.n > 1) out.push({ label: `${min.n - 1} ký tự (thiếu 1)`, value: repeat(numeric ? '1234567890' : 'abc', min.n - 1), expect: 'err' })
  if (has('email')) {
    out.push({ label: 'Email hợp lệ', value: 'test.qa@example.com', expect: 'ok' })
    out.push({ label: 'Thiếu tên miền', value: 'test.qa@', expect: 'err' })
    out.push({ label: 'Thiếu @', value: 'test.qa.example.com', expect: 'err' })
    out.push({ label: 'Có khoảng trắng', value: 'test qa@example.com', expect: 'err' })
  }
  if (has('phone')) {
    out.push({ label: 'SĐT hợp lệ', value: '0987654321', expect: 'ok' })
    out.push({ label: 'SĐT thiếu số', value: '098765', expect: 'err' })
    out.push({ label: 'SĐT có chữ', value: '09876abc21', expect: 'err' })
  } else if (has('digits')) {
    out.push({ label: 'Có chữ cái', value: '12ab34', expect: 'err' })
    out.push({ label: 'Có ký tự đặc biệt', value: '12-34.5', expect: 'err' })
  }
  const date = has('date')
  if (date && f.editable !== false) {
    const d = today
    const ok = date.fmt.replace('dd', pad(d.getDate())).replace('MM', pad(d.getMonth() + 1)).replace('yyyy', String(d.getFullYear())).replace(/HH|hh/, '08').replace('mm', '30').replace('ss', '00')
    out.push({ label: `Đúng định dạng ${date.fmt}`, value: ok, expect: 'ok' })
    out.push({ label: 'Ngày không tồn tại', value: date.fmt.replace('dd', '31').replace('MM', '02').replace('yyyy', String(d.getFullYear())), expect: 'err' })
    out.push({ label: 'Sai định dạng', value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, expect: 'err' })
  }
  if (has('noSpecial')) out.push({ label: 'Ký tự đặc biệt', value: 'Test@#$%', expect: 'err' })
  if (f.mandatory) out.push({ label: 'Chỉ khoảng trắng', value: '   ', expect: 'err' })
  if (!numeric && !has('email') && !date && /(ten|ho va ten|dia chi|noi|ghi chu|mo ta|ly do)/.test(fold(f.title))) {
    out.push({ label: 'Tiếng Việt có dấu', value: 'Nguyễn Thị Ánh Tuyết', expect: 'ok' })
  }
  return out
}

/* ------------------------------------------------------------------ test cases */

export interface ReqCase {
  id: string
  group: string
  purpose: string
  steps: string
  data?: string
  expected: string
  kind: 'ui' | 'field' | 'flow' | 'api'
  screen?: string
  field?: string
}

/** "Nếu X thì Y" / "X: Y" / "Tab chọn X thì Y" → condition + outcome. */
export function branchOf(line: string): { cond: string; action: string } | null {
  const l = line.replace(/^[-•+*–]\s*/, '').trim()
  let m = /^(?:nếu|khi|trường hợp|TH)\s+(.{3,160}?)\s+(?:thì|=>|→|->)\s*(.+)$/i.exec(l)
  if (m) return { cond: m[1].trim(), action: m[2].trim() }
  m = /^((?:tab|tap|click|nhấn|bấm|chọn|onclick)\b.{0,140}?)\s+(?:thì|=>|→|->)\s*(.+)$/i.exec(l)
  if (m) return { cond: m[1].trim(), action: m[2].trim() }
  m = /^([^:]{2,70}):\s*(.{3,})$/.exec(l)
  if (m && !/^(bước|step|lưu ý|chú ý|ghi chú|ví dụ|gồm|hiển thị|onclick)$/i.test(m[1].trim()) && !/https?$/i.test(m[1])) return { cond: m[1].trim(), action: m[2].trim() }
  // "User ticked mục X thì điều hướng sang …"
  m = /^(.{6,160}?)\s+thì\s+(.{4,})$/i.exec(l)
  if (m) return { cond: m[1].trim(), action: m[2].trim() }
  return null
}

/** An outcome worth a test case: not a lead-in to the next lines ("thì check:"). */
const realAction = (a: string): boolean => a.trim().length >= 3 && !/:\s*$/.test(a.trim())

/**
 * Branches of a multi-line cell: "Nếu X thì" + next line is one branch; a lead-in line ending in
 * ":" ("Tab chọn Tiếp tục thì check:") becomes the context of the branches below it.
 */
export function branchesOf(text: string): { cond: string; action: string; context?: string }[] {
  const ls = lines(text)
  const out: { cond: string; action: string; context?: string }[] = []
  let context: string | undefined
  for (let i = 0; i < ls.length; i++) {
    let l = ls[i]
    if (/\b(thì|=>|→)\s*$/i.test(l) && ls[i + 1]) l = `${l} ${ls[++i]}`
    const b = branchOf(l)
    if (b && realAction(b.action)) out.push({ ...b, context })
    else if (/:\s*$/.test(l)) context = (b ? b.cond : l.replace(/:\s*$/, '')).trim()
  }
  return out
}

const clip = (s: string, n = 400): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const numbered = (xs: string[]): string => xs.map((x, i) => `${i + 1}. ${x}`).join('\n')

/** Test cases a document implies: per screen (layout, each field's rules, events) and per API. */
export function casesOf(doc: ReqDoc): ReqCase[] {
  const out: ReqCase[] = []
  const seen = new Set<string>()
  const add = (c: Omit<ReqCase, 'id'>): boolean => {
    const key = fold(`${c.group}|${c.purpose}|${c.data ?? ''}`)
    // The same outcome described in the field table and again in the event table: keep one.
    const same = c.kind === 'flow' ? fold(`${c.group}|flow|${c.expected}`) : ''
    if (seen.has(key) || (same && seen.has(same))) return false
    seen.add(key)
    if (same) seen.add(same)
    out.push({ ...c, id: `c${out.length + 1}` })
    return true
  }
  for (const s of doc.screens) {
    const group = s.title
    const open = `Mở màn hình ${s.title}`
    const shown = s.fields.filter((f) => f.title)
    if (shown.length) {
      add({
        group,
        kind: 'ui',
        screen: s.id,
        purpose: `Kiểm tra giao diện màn hình ${s.title}`,
        steps: numbered([open, 'Quan sát bố cục và các thành phần trên màn hình']),
        expected: clip(`Hiển thị đầy đủ, đúng thứ tự các thành phần theo thiết kế:\n${shown.map((f) => `- ${f.title}${f.type ? ` (${f.type})` : ''}`).join('\n')}`, 1500)
      })
    }
    for (const f of shown) {
      const base = { group, screen: s.id, field: f.no || f.title, kind: 'field' as const }
      const rule = <K extends FieldRule['kind']>(k: K): Extract<FieldRule, { kind: K }> | undefined => f.rules.find((r) => r.kind === k) as Extract<FieldRule, { kind: K }> | undefined
      const choice = /(dropdown|select|radio|checkbox|combo|upload|picker|switch|toggle)/.test(fold(f.type))
      if (rule('disabled') && (isInput(f) || /(dropdown|select|combo)/.test(fold(f.type)))) {
        add({ ...base, purpose: `Kiểm tra trường "${f.title}" không cho phép chỉnh sửa`, steps: numbered([open, `Chạm vào trường "${f.title}" và thử nhập/sửa dữ liệu`]), expected: `Trường "${f.title}" ở trạng thái disable/readonly, không chỉnh sửa được dữ liệu` })
      }
      const editable = (f.editable !== false || allowsEdit(fold(f.desc))) && !rule('disabled')
      const input = editable && (isInput(f) || choice)
      if (input && f.mandatory && !rule('default') && !/radio/.test(fold(f.type))) {
        add({ ...base, purpose: `Kiểm tra bỏ trống trường bắt buộc "${f.title}"`, steps: numbered([open, `Để trống "${f.title}"`, 'Nhập hợp lệ các trường bắt buộc khác', 'Nhấn nút tiếp tục / xác nhận']), expected: `Hệ thống không cho phép tiếp tục: báo lỗi tại trường "${f.title}" hoặc nút tiếp tục bị disable` })
      }
      if (input) {
        for (const p of probesOf(f)) {
          if (p.value.trim() === '' && f.mandatory) continue
          add({
            ...base,
            purpose: `Kiểm tra trường "${f.title}" – ${p.label}`,
            steps: numbered([open, `Nhập "${f.title}" = giá trị ở cột dữ liệu`, 'Rời khỏi trường / nhấn tiếp tục']),
            data: p.value.length > 60 ? `${p.value.length} ký tự: ${p.value.slice(0, 20)}…` : p.value,
            expected: p.expect === 'ok' ? `Hệ thống chấp nhận giá trị, không báo lỗi` : `Hệ thống không chấp nhận (chặn nhập hoặc báo lỗi định dạng tại trường "${f.title}")`
          })
        }
      }
      const opts = rule('options')
      if (opts) add({ ...base, purpose: `Kiểm tra danh sách lựa chọn "${f.title}"`, steps: numbered([open, `Mở / quan sát "${f.title}"`]), expected: `Gồm: ${opts.values.join(', ')}` })
      const def = rule('default')
      if (def) add({ ...base, purpose: `Kiểm tra giá trị mặc định "${f.title}"`, steps: numbered([open]), expected: `"${f.title}" mặc định là “${def.value}”` })
      for (const l of lines(f.desc)) {
        const dis = /^disable\s+(?:khi\s+)?(.{4,200})$/i.exec(l)
        if (dis && !/không cho phép chỉnh sửa/i.test(l)) {
          add({ ...base, purpose: `Kiểm tra trạng thái "${f.title}" khi ${dis[1].replace(/\.$/, '')}`, steps: numbered([open, `Tạo điều kiện: ${dis[1].replace(/\.$/, '')}`]), expected: `"${f.title}" bị disable` })
        }
      }
      let branched = false
      for (const b of branchesOf(f.desc)) {
        if (/^disable\b/i.test(b.cond)) continue
        if (/^mặc định$/i.test(b.cond)) {
          add({ ...base, purpose: `Kiểm tra trạng thái mặc định "${f.title}"`, steps: numbered([open]), expected: `"${f.title}" mặc định: ${b.action}` })
          continue
        }
        if (/(button|link|icon|row|tab|radio|checkbox|picker|navigation|dropdown|item|card|menu)/.test(fold(f.type) + ' ' + fold(b.cond))) {
          add({ ...base, kind: 'flow', purpose: `Kiểm tra "${f.title}" – ${clip(b.cond, 160)}`, steps: numbered([open, ...(b.context ? [b.context] : [`Thao tác "${f.title}"`]), `Điều kiện: ${b.cond}`]), expected: clip(b.action) })
          branched = true
        }
      }
      // A plain "what the button does" case only when its branches did not already cover it.
      if (!branched && /(button|link|navigation|icon)/.test(fold(f.type))) {
        const click = lines(f.desc).find((l) => /^(onclick|tab chọn|nhấn|bấm|click)/i.test(l) && realAction(l))
        if (click) add({ ...base, kind: 'flow', purpose: `Kiểm tra chức năng "${f.title}"`, steps: numbered([open, `Nhấn "${f.title}"`]), expected: clip(click.replace(/^(onclick|tab chọn|nhấn|bấm|click)\s*[:→-]*\s*/i, '')) })
      }
    }
    let section = ''
    for (const r of s.flow) {
      if (r.section) section = r.section
      for (const b of branchesOf(r.text)) {
        add({ group, kind: 'flow', screen: s.id, purpose: `Kiểm tra xử lý${section ? ` ${section}` : ''} – ${clip(b.cond, 160)}`, steps: numbered([open, ...(b.context ? [b.context] : []), `Điều kiện: ${b.cond}`]), expected: clip(b.action) })
      }
    }
  }
  for (const a of doc.apis) {
    const short = shortApi(a.name)
    const group = `API: ${short}`
    const call = `Gọi ${short}${a.url ? ` (${a.method ?? 'POST'} ${a.url})` : ''}`
    const firstErr = a.steps.flatMap((s) => s.branches).find((b) => /(không hợp lệ|thiếu|lỗi|thất bại|false|nok)/i.test(b.cond))
    for (const p of a.inputs.filter((p) => p.required)) {
      add({ group, kind: 'api', purpose: `Kiểm tra ${short} thiếu tham số bắt buộc "${p.name}"`, steps: numbered([`${call} với đầy đủ tham số hợp lệ, bỏ "${p.name}"`]), expected: clip(firstErr?.action ?? 'API trả về lỗi thiếu tham số bắt buộc, không xử lý tiếp') })
    }
    for (const s of a.steps) {
      for (const b of s.branches) {
        // "Hợp lệ: thực hiện bước 2" only hands over to the next step, which has its own cases.
        if (/^(thực hiện|chuyển( sang)?|sang|tiếp tục)( xử lý)?( tiếp)? (bước|b) ?\d+\.?$/i.test(b.action.trim())) continue
        add({ group, kind: 'api', purpose: `Kiểm tra ${short} – Bước ${s.no}: ${clip(b.cond, 160)}`, steps: numbered([`${call}`, `Tạo điều kiện: ${b.cond}`]), expected: clip(b.action) })
      }
    }
    const ok = lines(a.outputText).find((l) => /^thành công/i.test(l)) ?? (a.outputs.length ? `Trả về các trường: ${a.outputs.slice(0, 12).map((o) => o.name).join(', ')}` : '')
    if (ok) add({ group, kind: 'api', purpose: `Kiểm tra ${short} trả về thành công`, steps: numbered([`${call} với đầy đủ tham số hợp lệ`]), expected: clip(ok.replace(/^thành công\s*:\s*/i, 'Thành công: ')) })
  }
  return out
}

/* ------------------------------------------------------------------ device check */

export interface ScanInput {
  label: string
  placeholder: string
  /** HTML maxlength (null = none / native). */
  maxLength: number | null
  disabled: boolean
  readOnly: boolean
  type: string
  source: 'webview' | 'native'
}

export interface ScreenScan {
  pkg: string
  /** Visible texts (native nodes + WebView innerText lines). */
  texts: string[]
  inputs: ScanInput[]
  /** Page URLs read through DevTools. */
  pages: string[]
  notes: string[]
}

export interface FieldCheck {
  field: ReqField
  found: boolean
  input?: ScanInput
  issues: string[]
}

export interface ScreenMatch {
  screen: ReqScreen
  /** Share of documented field titles visible on the phone (0..1). */
  score: number
  checks: FieldCheck[]
}

/** Score every documented screen against what the phone shows, best first. */
export function matchScreens(doc: ReqDoc, scan: ScreenScan): ScreenMatch[] {
  const hay = ` ${scan.texts.map(fold).join(' | ')} `
  const labels = scan.inputs.map((i) => ({ i, k: fold(`${i.label} ${i.placeholder}`) }))
  return doc.screens
    .map((screen) => {
      const named = screen.fields.filter((f) => fold(f.title).length >= 2)
      const checks: FieldCheck[] = named.map((field) => {
        const k = fold(field.title)
        const input = labels.find((l) => l.k && (l.k.includes(k) || (k.length > 6 && k.includes(l.k))))?.i
        const found = hay.includes(k) || !!input
        const issues: string[] = []
        if (input) {
          const max = field.rules.find((r) => r.kind === 'maxLen') as { n: number } | undefined
          if (max && input.maxLength !== null && input.maxLength !== max.n) issues.push(`maxlength trên app = ${input.maxLength}, tài liệu = ${max.n}`)
          if (max && input.maxLength === null && input.source === 'webview') issues.push(`ô nhập không đặt maxlength (tài liệu ≤ ${max.n}) – hãy thử điền ${max.n + 1} ký tự`)
          const locked = input.disabled || input.readOnly
          if (field.rules.some((r) => r.kind === 'disabled') && !locked) issues.push('tài liệu: không cho sửa, nhưng ô đang cho nhập')
          if (field.editable === true && !field.rules.some((r) => r.kind === 'disabled') && locked) issues.push('tài liệu: cho phép sửa, nhưng ô đang bị khoá')
          if (field.rules.some((r) => r.kind === 'email') && input.source === 'webview' && !/email|text/.test(input.type)) issues.push(`kiểu ô = ${input.type}`)
        }
        return { field, found, input, issues }
      })
      const found = checks.filter((c) => c.found).length
      const score = checks.length ? found / checks.length : 0
      // Rank by found × share: a small screen sharing "Quay lại" / "Họ và tên" must not win.
      return { screen, score, checks, rank: found * score }
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.rank - a.rank)
    .map(({ rank: _rank, ...m }) => m)
}

/** KBKT file name: the document's prefix (TLNV / MTYCTD…) replaced by KBKT. */
export function kbktNameOf(file: string): string {
  const base = file.replace(/\.docx$/i, '').replace(/\s*\(\d+\)/g, '')
  const swapped = base.replace(/^(TLGP|TLNV|MTYCTĐ|MTYCTD|MTYC)/i, 'KBKT')
  return `${swapped === base ? `KBKT_${base}` : swapped}.xlsx`.replace(/[\\/:*?"<>|]+/g, '_')
}
