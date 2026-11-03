/**
 * Documented APIs vs. what the app really sends and receives (calls captured by the network
 * watcher), and fake error answers for the error branches the document describes.
 */
import type { MockRule, NetCall } from './automation'
import { fold, shortApi, type ReqApi, type ReqDoc, type ReqParam } from './reqdoc'

/* ------------------------------------------------------------------ paths */

/** Path of a call URL without host and query ("/v1/api/find-staff"). */
export function pathOf(url: string): string {
  return url.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0] || url
}

/** Doc path → a stable substring to match calls: drops "{id}" / trailing numeric ids. */
export function matchKey(docPath: string): string {
  return pathOf(docPath)
    .replace(/\{[^}]*\}.*$/, '')
    .replace(/\/\d+(\/.*)?$/, '')
    .replace(/\/$/, '')
}

/** HTTP calls worth matching (no images / scripts / bridge commands). */
export const apiCalls = (calls: NetCall[]): NetCall[] =>
  calls.filter((c) => c.kind === 'http' && !/^(Image|Script|Stylesheet|Font|Media|Document)$/i.test(c.resourceType ?? '') && !/\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf)(\?|$)/i.test(c.url))

/** Distinct endpoints seen (method + path), newest first. */
export function endpointsOf(calls: NetCall[]): { method: string; path: string; count: number }[] {
  const m = new Map<string, { method: string; path: string; count: number; last: number }>()
  for (const c of apiCalls(calls)) {
    const path = pathOf(c.url)
    const k = `${c.method} ${path}`
    const e = m.get(k) ?? { method: c.method, path, count: 0, last: 0 }
    e.count++
    e.last = Math.max(e.last, c.startedAt)
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => b.last - a.last)
}

/** Best guess of the recorded endpoint for a documented API (doc URL, or slug in its name). */
export function suggestPath(api: ReqApi, calls: NetCall[]): string | null {
  const eps = endpointsOf(calls)
  if (api.url) {
    const k = matchKey(api.url).toLowerCase()
    const hit = eps.find((e) => k && (e.path.toLowerCase().includes(k) || k.endsWith(e.path.toLowerCase())))
    if (hit) return hit.path
  }
  // "API recognize-image-business-v1", "API find-staff": a slug in the name.
  const slugs = [...api.name.matchAll(/([a-z][a-z0-9]*(?:[-_/][a-z0-9]+)+)/gi)].map((m) => m[1].toLowerCase())
  for (const s of slugs.sort((a, b) => b.length - a.length)) {
    const hit = eps.find((e) => e.path.toLowerCase().includes(s))
    if (hit) return hit.path
  }
  return null
}

/* ------------------------------------------------------------------ JSON keys */

/** Every key name and dotted path in a JSON value (array items merged: list.item.name). */
export function keysOf(v: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 20)) keysOf(x, prefix, out)
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${k}` : k
      const t = x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x
      if (!out.has(p) || out.get(p) === 'null') out.set(p, t)
      keysOf(x, p, out)
    }
  }
  return out
}

/** Parse a captured body: JSON, form-urlencoded, or (clipped JSON) a key scan. */
export function parseBody(s: string | undefined): { keys: Map<string, string>; clipped: boolean; json: boolean } {
  const keys = new Map<string, string>()
  if (!s) return { keys, clipped: false, json: false }
  const t = s.trim()
  try {
    return { keys: keysOf(JSON.parse(t)), clipped: false, json: true }
  } catch {
    /* not (whole) JSON */
  }
  if (/^[{[]/.test(t)) {
    // Clipped JSON: names only, no nesting.
    for (const m of t.matchAll(/"([A-Za-z_][\w-]*)"\s*:/g)) keys.set(m[1], '?')
    return { keys, clipped: true, json: true }
  }
  if (/^[\w.%[\]-]+=/.test(t)) for (const [k] of new URLSearchParams(t)) keys.set(k, 'string')
  return { keys, clipped: false, json: false }
}

/** A documented param name that is a real field name (MTYCTD) rather than a description (TLNV). */
export const isFieldName = (name: string): boolean => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[\])*$/.test(name.trim())

const docType = (t?: string): string[] => {
  const v = fold(t ?? '')
  const out: string[] = []
  if (/string|chuoi|text|date/.test(v)) out.push('string')
  if (/number|int|long|double|float|decimal|\bso\b/.test(v)) out.push('number')
  if (/bool/.test(v)) out.push('boolean')
  if (/array|list|mang/.test(v)) out.push('array')
  if (/object|json|map/.test(v)) out.push('object')
  if (/null/.test(v)) out.push('null')
  return out
}

/* ------------------------------------------------------------------ conformance */

export interface ParamCheck {
  param: ReqParam
  /** Key in the real call this param maps to (same name, or mapped by hand). */
  key?: string
  /** absent = a documented response field not in this answer (may be optional / empty list). */
  state: 'ok' | 'missing' | 'absent' | 'type' | 'unmapped'
  note?: string
}

export interface ConformReport {
  api: ReqApi
  path: string
  calls: NetCall[]
  /** The call the details below come from (latest with a response). */
  sample?: NetCall
  method?: { doc: string; real: string }
  inputs: ParamCheck[]
  outputs: ParamCheck[]
  /** Keys the app sends / receives that the document does not mention (top level). */
  extraIn: string[]
  extraOut: string[]
  notes: string[]
}

/** Manual "doc param → real key" mapping (TLNV params are descriptions, not field names). */
export type FieldMap = Record<string, string>

const req = (clipped: boolean): string => (clipped ? 'không thấy (request bị cắt)' : 'app không gửi tham số bắt buộc này')

function checkParams(params: ReqParam[], keys: Map<string, string>, map: FieldMap, dir: 'in' | 'out', clipped: boolean): ParamCheck[] {
  const lower = new Map([...keys.keys()].map((k) => [k.toLowerCase(), k]))
  const leaf = new Map<string, string>()
  for (const k of keys.keys()) leaf.set(k.split('.').pop()!.toLowerCase(), k)
  return params.map((param) => {
    const mapped = map[`${dir}:${param.name}`]
    const name = mapped || (isFieldName(param.name) ? param.name.replace(/\[\]/g, '') : '')
    if (!name) return { param, state: 'unmapped' as const, note: 'Tài liệu không ghi tên trường — chọn trường tương ứng một lần' }
    const n = name.toLowerCase()
    const key = lower.get(n) ?? [...keys.keys()].find((k) => k.toLowerCase().endsWith(`.${n}`)) ?? (n.includes('.') ? undefined : leaf.get(n))
    if (!key) {
      if (dir === 'out') return { param, state: 'absent' as const, note: clipped ? 'không thấy (phản hồi bị cắt, có thể nằm ở phần sau)' : 'không có trong lần trả về này (trường tuỳ chọn hoặc danh sách rỗng?)' }
      return param.required
        ? { param, state: 'missing' as const, note: req(clipped) }
        : { param, state: 'ok' as const, note: 'không gửi (không bắt buộc)' }
    }
    const want = docType(param.type)
    const real = keys.get(key) ?? '?'
    // "String – True: Thành công / False: Có lỗi" documents a boolean in practice.
    const boolDoc = real === 'boolean' && /\btrue\b|\bfalse\b/i.test(param.desc)
    if (want.length && real !== '?' && real !== 'null' && !want.includes(real) && !boolDoc)
      return { param, key, state: 'type' as const, note: `tài liệu: ${param.type}, thực tế: ${real}` }
    if (real === 'null' && want.length && !want.includes('null') && param.required) return { param, key, state: 'type' as const, note: 'thực tế: null' }
    return { param, key, state: 'ok' as const }
  })
}

export function conformance(api: ReqApi, path: string, calls: NetCall[], map: FieldMap = {}): ConformReport {
  const mine = apiCalls(calls).filter((c) => pathOf(c.url).toLowerCase().includes(path.toLowerCase()))
  // Answers faked by ADB Kit say nothing about the real API: compare against real ones only.
  const real = mine.filter((c) => !c.mocked)
  const sample = [...real].reverse().find((c) => c.status !== undefined) ?? real[real.length - 1]
  const notes: string[] = []
  const r: ConformReport = { api, path, calls: mine, sample, inputs: [], outputs: [], extraIn: [], extraOut: [], notes }
  if (!sample) return r
  if (api.method && sample.method && api.method.toUpperCase() !== sample.method.toUpperCase()) r.method = { doc: api.method, real: sample.method }
  const req = parseBody(sample.args)
  for (const [k] of new URLSearchParams(sample.url.split('?')[1] ?? '')) req.keys.set(k, 'string')
  const res = parseBody(sample.result)
  if (sample.status !== undefined && sample.status >= 400) notes.push(`Lần gọi mẫu trả HTTP ${sample.status}`)
  if (!sample.result) notes.push('Không có nội dung phản hồi (app native qua Chucker có thể không lưu body)')
  if (res.clipped) notes.push('Phản hồi dài bị cắt — chỉ kiểm tra được tên trường ở phần đầu')
  r.inputs = checkParams(api.inputs, req.keys, map, 'in', req.clipped)
  r.outputs = checkParams(api.outputs, res.keys, map, 'out', res.clipped)
  const known = (ps: ParamCheck[]): Set<string> => new Set(ps.flatMap((p) => (p.key ? [p.key.split('.')[0].toLowerCase()] : [])).concat(ps.map((p) => p.param.name.split('.')[0].toLowerCase())))
  const kin = known(r.inputs)
  const kout = known(r.outputs)
  r.extraIn = [...req.keys.keys()].filter((k) => !k.includes('.') && !kin.has(k.toLowerCase())).slice(0, 30)
  // Response wrappers (data / result) are structure, not undocumented fields.
  r.extraOut = api.outputs.length ? [...res.keys.keys()].filter((k) => !k.includes('.') && !kout.has(k.toLowerCase()) && !/^(data|result|body|payload)$/i.test(k)).slice(0, 30) : []
  return r
}

export const conformIssues = (r: ConformReport): number =>
  (r.method ? 1 : 0) + [...r.inputs, ...r.outputs].filter((p) => p.state === 'missing' || p.state === 'type').length

/* ------------------------------------------------------------------ error scenarios */

export interface Scenario {
  id: string
  label: string
  /** What the document says the app must do then. */
  expect: string
  rule: Omit<MockRule, 'match'>
}

const BAD = /(không hợp lệ|không thành công|thất bại|lỗi|false|nok|vượt|hết hạn|không khớp|không tồn tại|không có|chưa có|từ chối|timeout|quá thời gian)/i

/** Fake answers for the error branches a documented API has, plus generic network failures. */
export function scenariosOf(api: ReqApi, doc: ReqDoc): Scenario[] {
  const out: Scenario[] = []
  const names = new Set(api.outputs.map((o) => o.name.toLowerCase()))
  const hasSuccess = names.has('success') || /success/i.test(api.outputText)
  const codeKey = names.has('code') ? 'code' : names.has('errorcode') ? 'errorCode' : names.has('status') ? 'status' : 'code'
  const msgKey = names.has('message') ? 'message' : names.has('msg') ? 'msg' : names.has('description') ? 'description' : 'message'
  const body = (code: string, msg: string): string =>
    JSON.stringify({ ...(hasSuccess ? { success: false } : {}), [codeKey]: code, [msgKey]: msg, data: null })
  // Screen rows that say what the UI does on an API error ("Nếu success = false thì hiển thị popup…").
  const screen = doc.screens.find((s) => s.title === api.screen || (api.screen && s.path.includes(api.screen)))
  const uiErr = screen?.flow.map((r) => r.text.replace(/\n/g, ' ')).find((t) => /(success\s*=\s*false|lỗi|thất bại|không thành công)/i.test(t))
  const uiExpect = uiErr ? `Màn hình: ${uiErr}` : 'App báo lỗi rõ ràng (popup / thông báo), không treo, không văng'
  for (const c of api.codes.filter((c) => !/^2\d\d$/.test(c.code) && !/^(0|00|200|success)$/i.test(c.code)).slice(0, 8)) {
    const http = /^[45]\d\d$/.test(c.code) ? Number(c.code) : 200
    out.push({ id: `code:${c.code}`, label: `Mã ${c.code}`, expect: c.message || uiExpect, rule: { kind: 'any', action: 'status', status: http, body: body(c.code, c.message || `ADB Kit giả lập mã ${c.code}`) } })
  }
  let n = 0
  for (const s of api.steps) {
    for (const b of s.branches) {
      if (!BAD.test(b.cond) || n >= 8) continue
      // "Không có giao dịch cũ → thực hiện bước 3" continues the normal flow: not an error.
      if (/^(thực hiện|chuyển( sang)?|sang|tiếp tục)( xử lý)?( tiếp)? (bước|b) ?\d+\.?$/i.test(b.action.trim())) continue
      n++
      out.push({
        id: `b:${s.no}:${n}`,
        label: `Bước ${s.no}: ${b.cond.length > 50 ? `${b.cond.slice(0, 49)}…` : b.cond}`,
        expect: `${b.action}${uiErr ? ` · ${uiExpect}` : ''}`,
        rule: { kind: 'any', action: 'status', status: 200, body: body('ADBKIT_TEST', `ADB Kit giả lập: ${b.cond}`) }
      })
    }
  }
  if (hasSuccess && !out.length) out.push({ id: 'false', label: 'success = false', expect: uiExpect, rule: { kind: 'any', action: 'status', status: 200, body: body('ADBKIT_TEST', 'ADB Kit giả lập lỗi nghiệp vụ') } })
  out.push(
    { id: 'http500', label: 'Server lỗi (HTTP 500)', expect: uiExpect, rule: { kind: 'any', action: 'status', status: 500, body: body('500', 'Internal Server Error (ADB Kit giả lập)') } },
    { id: 'http401', label: 'Hết phiên (HTTP 401)', expect: 'App đưa về đăng nhập / làm mới phiên, không lặp vô hạn', rule: { kind: 'any', action: 'status', status: 401, body: body('401', 'Unauthorized (ADB Kit giả lập)') } },
    { id: 'net', label: 'Mất mạng', expect: 'Thông báo mất kết nối, cho thử lại', rule: { kind: 'any', action: 'error' } },
    { id: 'slow', label: 'Chậm 15 giây', expect: 'Có loading, không bấm được 2 lần, xử lý hết thời gian chờ', rule: { kind: 'any', action: 'delay', delayMs: 15000 } }
  )
  return out
}

export const scenarioTitle = (api: ReqApi, s: Scenario): string => `${shortApi(api.name)} – ${s.label}`
