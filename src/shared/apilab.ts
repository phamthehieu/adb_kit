/**
 * Active API testing ("Bắn thử API"): build or import an HTTP request from a captured device call,
 * a BA requirement document (SRS), a Swagger/OpenAPI spec, Postman collection, or cURL; obtain auth
 * tokens either from the live phone (FE) or directly from a Backend Login API; generate negative/boundary
 * test probes and evaluate server answers.
 */
import type { NetCall } from './automation'
import { isFieldName, pathOf, type FieldMap } from './reqapi'
import { fold, type ReqApi, type ReqParam } from './reqdoc'

/* ------------------------------------------------------------------ model */

export interface ApiHeader {
  name: string
  value: string
  enabled: boolean
}

export interface ApiRequest {
  method: string
  url: string
  headers: ApiHeader[]
  body: string
  timeoutMs?: number
}

export interface ApiResponse {
  ok: boolean
  status: number
  statusText: string
  durationMs: number
  headers: { name: string; value: string }[]
  body: string
  size: number
  error?: string
}

export interface SavedApiItem {
  id: string
  name: string
  pkg?: string
  req: ApiRequest
  updatedAt: number
}

export type ProbeExpect = 'ok' | 'auth_err' | 'val_err'

export interface ApiProbe {
  id: string
  kind: 'happy' | 'unauth' | 'bad_token' | 'missing' | 'empty' | 'type' | 'Injection'
  label: string
  purpose: string
  dataLabel: string
  expectedText: string
  expect: ProbeExpect
  req: ApiRequest
}

export interface ApiProbeRun {
  probe: ApiProbe
  res: ApiResponse
  pass: boolean
  status: 'P' | 'F'
  reason: string
}

/* ----------------------------------------------------- call / cURL conversion */

const DROP_HEADERS = /^(:method|:path|:authority|:scheme|host|content-length|connection|accept-encoding)$/i
const AUTH_HEADERS = /^(authorization|cookie|x-access-token|x-auth-token|token|x-api-key|apikey)$/i

/** Turn a captured HTTP call (WebView, Bridge, Tauri, or Chucker) into an editable request. */
export function requestFromCall(c: NetCall): ApiRequest {
  const seen = new Set<string>()
  const headers: ApiHeader[] = []
  for (const h of c.reqHeaders ?? []) {
    if (!h.name || DROP_HEADERS.test(h.name)) continue
    const k = h.name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    headers.push({ name: h.name, value: h.value, enabled: true })
  }
  const rawBody = c.args && !/^\(dữ liệu nhị phân/.test(c.args) ? c.args.replace(/…\s*\(\d+ ký tự\)$/, '') : ''
  let body = rawBody
  if (rawBody) {
    try {
      body = JSON.stringify(JSON.parse(rawBody), null, 2)
      if (!seen.has('content-type')) headers.push({ name: 'Content-Type', value: 'application/json', enabled: true })
    } catch {
      /* keep raw string */
    }
  }
  return {
    method: (c.method || 'GET').toUpperCase(),
    url: c.url,
    headers,
    body
  }
}

/** Guess a realistic sample value for a documented API parameter when FE hasn't called the API yet. */
function sampleValueForParam(key: string, p: ReqParam): unknown {
  const t = fold(p.type ?? '')
  const k = fold(`${key} ${p.name} ${p.desc ?? ''}`)
  if (/array|list|mang/.test(t) || /\[\]$/.test(p.name.trim())) return []
  if (/object|json|map/.test(t)) return {}
  if (/bool/.test(t)) return true
  if (/number|int|long|double|float|decimal|\bso\b/.test(t)) {
    if (/page|trang/.test(k)) return 1
    if (/size|limit|ipp|perpage/.test(k)) return 20
    if (/amount|price|tien|gia|total/.test(k)) return 100000
    return 1
  }
  if (/phone|mobile|msisdn|sdt|so dien thoai/.test(k)) return '0987654321'
  if (/email|mail/.test(k)) return 'tester@example.com'
  if (/date|ngay|time|from|to/.test(k)) return '2026-01-15'
  if (/id$|code$|ma /.test(k)) return '1'
  return 'test_value'
}

/**
 * Build a ready-to-send ApiRequest directly from a BA Requirement API spec (`ReqApi`),
 * allowing testers to test the API independently even when the mobile FE is down or unbuilt.
 */
export function requestFromDocApi(api: ReqApi, baseUrl = '{{baseUrl}}', fieldMap: FieldMap = {}): ApiRequest {
  const method = (api.method || (api.inputs.length ? 'POST' : 'GET')).toUpperCase()
  const rawPath = (api.url || `/api/${fold(api.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`).trim()
  const cleanBase = (baseUrl || '{{baseUrl}}').replace(/\/+$/, '')
  let url = /^https?:\/\//i.test(rawPath) || rawPath.startsWith('{{')
    ? rawPath
    : `${cleanBase}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`

  const headers: ApiHeader[] = [
    { name: 'Accept', value: 'application/json', enabled: true },
    { name: 'Authorization', value: 'Bearer {{token}}', enabled: true }
  ]

  const bodyObj: Record<string, unknown> = {}
  const queryParams = new URLSearchParams()

  for (let idx = 0; idx < api.inputs.length; idx++) {
    const p = api.inputs[idx]
    const mapped = fieldMap[`in:${p.name}`]
    const rawKey = mapped || (isFieldName(p.name) ? p.name.trim() : `param_${idx + 1}`)
    const cleanKey = rawKey.replace(/\[\]/g, '')
    if (!cleanKey || /^(authorization|token|bearer|access_token)$/i.test(cleanKey)) continue
    const val = sampleValueForParam(cleanKey, p)

    if (/^(GET|HEAD|DELETE)$/i.test(method)) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        queryParams.set(cleanKey, String(val))
      }
    } else {
      const parts = cleanKey.split('.')
      let cur: Record<string, unknown> = bodyObj
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i]
        if (!cur[seg] || typeof cur[seg] !== 'object' || Array.isArray(cur[seg])) {
          cur[seg] = {}
        }
        cur = cur[seg] as Record<string, unknown>
      }
      cur[parts[parts.length - 1]] = val
    }
  }

  let body = ''
  if (/^(GET|HEAD|DELETE)$/i.test(method)) {
    const qs = queryParams.toString()
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  } else {
    headers.unshift({ name: 'Content-Type', value: 'application/json', enabled: true })
    body = JSON.stringify(Object.keys(bodyObj).length ? bodyObj : { sample: 'value' }, null, 2)
  }

  return { method, url, headers, body }
}

/** Pull the freshest auth headers (Authorization, Cookie, token…) from recent device calls. */
export function applyLiveAuth(req: ApiRequest, calls: NetCall[]): { req: ApiRequest; updated: string[] } {
  const host = /^https?:\/\/([^/]+)/i.exec(req.url)?.[1]?.toLowerCase()
  const recent = [...calls].filter((c) => c.kind === 'http' && c.reqHeaders?.length).sort((a, b) => b.startedAt - a.startedAt)
  const sameHost = host ? recent.filter((c) => c.url.toLowerCase().includes(host)) : []
  const pool = [...sameHost, ...recent]

  const found = new Map<string, { name: string; value: string }>()
  for (const c of pool) {
    for (const h of c.reqHeaders ?? []) {
      const k = h.name.toLowerCase()
      if (AUTH_HEADERS.test(k) && h.value && !found.has(k)) {
        found.set(k, { name: h.name, value: h.value })
      }
    }
  }
  if (!found.size) return { req, updated: [] }

  const headers = req.headers.map((h) => ({ ...h }))
  const updated: string[] = []
  for (const [k, live] of found) {
    const idx = headers.findIndex((h) => h.name.toLowerCase() === k)
    if (idx >= 0) {
      if (headers[idx].value !== live.value || !headers[idx].enabled) {
        headers[idx] = { name: headers[idx].name, value: live.value, enabled: true }
        updated.push(live.name)
      }
    } else {
      headers.unshift({ name: live.name, value: live.value, enabled: true })
      updated.push(live.name)
    }
  }
  return { req: { ...req, headers }, updated }
}

const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** Format an ApiRequest as a standard cURL command for sharing with backend devs. */
export function toCurl(req: ApiRequest): string {
  const parts = [`curl -X ${(req.method || 'GET').toUpperCase()} ${sq(req.url)}`]
  for (const h of req.headers) {
    if (!h.enabled || !h.name.trim()) continue
    parts.push(`  -H ${sq(`${h.name.trim()}: ${h.value}`)}`)
  }
  if (req.body.trim() && !/^(GET|HEAD)$/i.test(req.method)) {
    parts.push(`  --data-raw ${sq(req.body)}`)
  }
  return parts.join(' \\\n')
}

/** Parse a pasted cURL command into an ApiRequest. */
export function fromCurl(input: string): ApiRequest | null {
  const clean = input.replace(/\\\r?\n/g, ' ').trim()
  if (!/^curl\b/i.test(clean)) return null

  const tokens: string[] = []
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean))) {
    if (m[1] !== undefined) tokens.push(m[1].replace(/\\'/g, "'"))
    else if (m[2] !== undefined) tokens.push(m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n'))
    else if (m[3] !== undefined) tokens.push(m[3])
  }

  let method = ''
  let url = ''
  const headers: ApiHeader[] = []
  let body = ''

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if ((t === '-X' || t === '--request') && tokens[i + 1]) {
      method = tokens[++i].toUpperCase()
    } else if ((t === '-H' || t === '--header') && tokens[i + 1]) {
      const raw = tokens[++i]
      const colon = raw.indexOf(':')
      if (colon > 0) {
        const name = raw.slice(0, colon).trim()
        const value = raw.slice(colon + 1).trim()
        if (!DROP_HEADERS.test(name)) headers.push({ name, value, enabled: true })
      }
    } else if ((t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') && tokens[i + 1]) {
      body = tokens[++i]
    } else if (t === '--url' && tokens[i + 1]) {
      url = tokens[++i]
    } else if (!t.startsWith('-') && /^https?:\/\//i.test(t)) {
      url = t
    }
  }
  if (!url) return null
  if (!method) method = body ? 'POST' : 'GET'
  if (body) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      /* keep raw */
    }
  }
  return { method, url, headers, body }
}

/* ----------------------------------------------------- negative / boundary probes */

function cloneReq(req: ApiRequest): ApiRequest {
  return {
    method: req.method,
    url: req.url,
    headers: req.headers.map((h) => ({ ...h })),
    body: req.body,
    timeoutMs: req.timeoutMs
  }
}

function deleteAtPath(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.')
  let cur: unknown = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return false
    cur = (cur as Record<string, unknown>)[parts[i]]
  }
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return false
  const last = parts[parts.length - 1]
  if (!(last in (cur as Record<string, unknown>))) return false
  delete (cur as Record<string, unknown>)[last]
  return true
}

function setAtPath(obj: Record<string, unknown>, path: string, val: unknown): boolean {
  const parts = path.split('.')
  let cur: unknown = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return false
    cur = (cur as Record<string, unknown>)[parts[i]]
  }
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return false
  ;(cur as Record<string, unknown>)[parts[parts.length - 1]] = val
  return true
}

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** Collect leaf/top keys in a JSON object for automatic fuzzing when no BA doc is attached. */
function jsonPaths(obj: Record<string, unknown>, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      jsonPaths(v as Record<string, unknown>, p, out)
    } else {
      out.push(p)
    }
  }
  return out
}

/**
 * Generate a suite of API test probes from a captured/edited request and (optionally) its
 * BA requirement specification (`ReqApi`).
 */
export function probesForRequest(base: ApiRequest, api?: ReqApi, fieldMap: FieldMap = {}): ApiProbe[] {
  const out: ApiProbe[] = []
  const short = api?.name ? api.name.replace(/^API\s+/i, '').trim() : `${base.method} ${pathOf(base.url)}`

  // 1. Happy case (baseline)
  out.push({
    id: 'happy',
    kind: 'happy',
    label: 'Hợp lệ (Gốc)',
    purpose: `Kiểm tra ${short} thành công với bộ tham số hợp lệ`,
    dataLabel: 'Gữ nguyên tham số chuẩn từ app',
    expectedText: 'HTTP 200/2xx, phản hồi thành công đúng đặc tả',
    expect: 'ok',
    req: cloneReq(base)
  })

  // 2. Auth checks (if request carries auth headers)
  const authIdx = base.headers.findIndex((h) => h.enabled && AUTH_HEADERS.test(h.name))
  if (authIdx >= 0) {
    const noAuth = cloneReq(base)
    noAuth.headers = noAuth.headers.map((h) => (AUTH_HEADERS.test(h.name) ? { ...h, enabled: false } : h))
    out.push({
      id: 'unauth',
      kind: 'unauth',
      label: 'Bỏ Token / Auth',
      purpose: `Kiểm tra bảo mật ${short} khi không gửi thông tin xác thực (${base.headers[authIdx].name})`,
      dataLabel: `Bỏ header ${base.headers[authIdx].name}`,
      expectedText: 'Server từ chối truy cập (HTTP 401/403 hoặc mã lỗi xác thực), không lộ dữ liệu',
      expect: 'auth_err',
      req: noAuth
    })

    const badAuth = cloneReq(base)
    badAuth.headers = badAuth.headers.map((h) =>
      h.name.toLowerCase() === base.headers[authIdx].name.toLowerCase()
        ? { ...h, value: /^bearer\s+/i.test(h.value) ? 'Bearer invalid_token_adbkit_expired' : 'invalid_token_adbkit' }
        : h
    )
    out.push({
      id: 'bad_token',
      kind: 'bad_token',
      label: 'Token sai / hết hạn',
      purpose: `Kiểm tra ${short} khi gửi Token không hợp lệ hoặc hết hạn`,
      dataLabel: `${base.headers[authIdx].name}: token giả/sai`,
      expectedText: 'Server từ chối (HTTP 401/403 hoặc báo lỗi phiên đăng nhập)',
      expect: 'auth_err',
      req: badAuth
    })
  }

  // Parse JSON body or URL query parameters
  let jsonBody: Record<string, unknown> | null = null
  if (base.body.trim()) {
    try {
      const parsed = JSON.parse(base.body)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        jsonBody = parsed as Record<string, unknown>
      }
    } catch {
      /* not a JSON object */
    }
  }

  const [baseUrl, rawQuery = ''] = base.url.split('?')
  const queryParams = new URLSearchParams(rawQuery)

  // Determine target fields to test
  interface TargetField {
    key: string
    label: string
    where: 'json' | 'query'
    required: boolean
    wantType?: 'string' | 'number' | 'boolean'
  }

  const targets: TargetField[] = []
  const seenKeys = new Set<string>()
  const allJsonKeys = jsonBody ? jsonPaths(jsonBody) : []
  const lowerJsonMap = new Map(allJsonKeys.map((k) => [k.toLowerCase(), k]))
  for (const k of allJsonKeys) lowerJsonMap.set(k.split('.').pop()!.toLowerCase(), k)

  if (api?.inputs.length) {
    for (const p of api.inputs) {
      const mapped = fieldMap[`in:${p.name}`] || (isFieldName(p.name) ? p.name.replace(/\[\]/g, '') : '')
      if (!mapped) continue
      const lower = mapped.toLowerCase()
      const jk = lowerJsonMap.get(lower)
      const qk = [...queryParams.keys()].find((k) => k.toLowerCase() === lower)
      const tFold = fold(p.type ?? '')
      const wantType: TargetField['wantType'] = /number|int|long|double|float|so/.test(tFold)
        ? 'number'
        : /bool/.test(tFold)
          ? 'boolean'
          : /string|chuoi|text|date/.test(tFold)
            ? 'string'
            : undefined
      if (jk && !seenKeys.has(`json:${jk}`)) {
        seenKeys.add(`json:${jk}`)
        targets.push({ key: jk, label: p.name, where: 'json', required: p.required, wantType })
      } else if (qk && !seenKeys.has(`query:${qk}`)) {
        seenKeys.add(`query:${qk}`)
        targets.push({ key: qk, label: p.name, where: 'query', required: p.required, wantType })
      }
    }
  }

  // Fallback / additional keys from the actual payload (up to 8 fields so the suite stays fast)
  if (jsonBody) {
    for (const jk of allJsonKeys) {
      if (targets.length >= 8) break
      if (seenKeys.has(`json:${jk}`)) continue
      const val = getAtPath(jsonBody, jk)
      if (val === null || val === undefined || val === '') continue
      seenKeys.add(`json:${jk}`)
      const wantType = typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : 'string'
      targets.push({ key: jk, label: jk, where: 'json', required: true, wantType })
    }
  }
  for (const [qk, qv] of queryParams.entries()) {
    if (targets.length >= 8) break
    if (!qv || seenKeys.has(`query:${qk}`)) continue
    seenKeys.add(`query:${qk}`)
    targets.push({ key: qk, label: qk, where: 'query', required: true, wantType: /^\d+$/.test(qv) ? 'number' : 'string' })
  }

  for (const t of targets) {
    if (t.where === 'json' && jsonBody) {
      if (t.required) {
        // Probe: omit required field
        const copy = structuredClone(jsonBody)
        if (deleteAtPath(copy, t.key)) {
          const r = cloneReq(base)
          r.body = JSON.stringify(copy, null, 2)
          out.push({
            id: `missing:${t.key}`,
            kind: 'missing',
            label: `Bỏ trường "${t.label}"`,
            purpose: `Kiểm tra ${short} khi bỏ thiếu tham số bắt buộc "${t.label}"`,
            dataLabel: `Xoá "${t.key}" khỏi JSON body`,
            expectedText: `Server trả lỗi thiếu tham số "${t.label}" (HTTP 400/422 hoặc success = false), không lỗi 500`,
            expect: 'val_err',
            req: r
          })
        }
        // Probe: empty string
        const copyEmpty = structuredClone(jsonBody)
        if (setAtPath(copyEmpty, t.key, '')) {
          const r = cloneReq(base)
          r.body = JSON.stringify(copyEmpty, null, 2)
          out.push({
            id: `empty:${t.key}`,
            kind: 'empty',
            label: `Rỗng "${t.label}" = ""`,
            purpose: `Kiểm tra ${short} khi truyền rỗng tham số bắt buộc "${t.label}"`,
            dataLabel: `"${t.key}": ""`,
            expectedText: `Server kiểm tra và báo lỗi "${t.label}" không được rỗng, không lỗi 500`,
            expect: 'val_err',
            req: r
          })
        }
      }

      // Probe: wrong data type / special chars
      if (t.wantType === 'number') {
        const copyType = structuredClone(jsonBody)
        if (setAtPath(copyType, t.key, 'abc_invalid_number')) {
          const r = cloneReq(base)
          r.body = JSON.stringify(copyType, null, 2)
          out.push({
            id: `type:${t.key}`,
            kind: 'type',
            label: `Sai kiểu "${t.label}" = "abc"`,
            purpose: `Kiểm tra ${short} khi truyền chữ vào trường số "${t.label}"`,
            dataLabel: `"${t.key}": "abc_invalid_number"`,
            expectedText: `Server báo lỗi sai định dạng dữ liệu trường "${t.label}", không sập HTTP 500`,
            expect: 'val_err',
            req: r
          })
        }
      } else if (t.wantType === 'string') {
        const copyInj = structuredClone(jsonBody)
        if (setAtPath(copyInj, t.key, "' OR '1'='1' -- <script>alert(1)</script>")) {
          const r = cloneReq(base)
          r.body = JSON.stringify(copyInj, null, 2)
          out.push({
            id: `inj:${t.key}`,
            kind: 'Injection',
            label: `Ký tự đặc biệt "${t.label}"`,
            purpose: `Kiểm tra ${short} xử lý ký tự đặc biệt / SQLi / XSS tại "${t.label}"`,
            dataLabel: `"${t.key}": "' OR '1'='1' -- <script>..."`,
            expectedText: 'Server xử lý an toàn hoặc từ chối hợp lệ, tuyệt đối không trả lỗi HTTP 500 / lộ SQL error',
            expect: 'val_err',
            req: r
          })
        }
      }
    } else if (t.where === 'query') {
      if (t.required) {
        const qp = new URLSearchParams(rawQuery)
        qp.delete(t.key)
        const r = cloneReq(base)
        const qs = qp.toString()
        r.url = qs ? `${baseUrl}?${qs}` : baseUrl
        out.push({
          id: `missing:${t.key}`,
          kind: 'missing',
          label: `Bỏ query "${t.label}"`,
          purpose: `Kiểm tra ${short} khi thiếu query param "${t.label}"`,
          dataLabel: `Bỏ ${t.key} trên URL`,
          expectedText: `Server báo lỗi thiếu tham số "${t.label}", không lỗi 500`,
          expect: 'val_err',
          req: r
        })
      }
    }
  }

  return out
}

/* ----------------------------------------------------- evaluate probe response */

function parseJsonBody(body: string): Record<string, unknown> | null {
  if (!body) return null
  try {
    const v = JSON.parse(body)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Check if a 2xx JSON response actually indicates a business/validation error. */
function detectBusinessError(json: Record<string, unknown> | null): string | null {
  if (!json) return null
  if (json.success === false || json.ok === false || json.status === false) {
    return String(json.message ?? json.msg ?? json.error ?? json.description ?? 'success = false')
  }
  const code = json.code ?? json.errorCode ?? json.errCode ?? json.statusCode
  if (code !== undefined && code !== null && !/^(0|00|200|201|ok|success|true)$/i.test(String(code).trim())) {
    const msg = json.message ?? json.msg ?? json.error ?? json.description
    return `Mã lỗi ${code}${msg ? `: ${msg}` : ''}`
  }
  if (typeof json.error === 'string' && json.error.trim()) {
    return json.error.trim()
  }
  return null
}

/** Evaluate whether an API response satisfies a probe's expectation. */
export function evalProbe(probe: ApiProbe, res: ApiResponse): { pass: boolean; status: 'P' | 'F'; reason: string } {
  if (res.error || res.status === 0) {
    return { pass: false, status: 'F', reason: `Lỗi kết nối: ${res.error || 'Không nhận được phản hồi'}` }
  }
  const json = parseJsonBody(res.body)
  const bizErr = detectBusinessError(json)

  // Server crash (5xx) is ALWAYS a bug for validation/auth/happy probes!
  if (res.status >= 500) {
    return {
      pass: false,
      status: 'F',
      reason: `Server sập HTTP ${res.status} (Backend chưa bắt ngoại lệ cho trường hợp này!)`
    }
  }

  // SQL error leak check
  if (/(SQLSyntaxError|ORA-\d{5}|PSQLException|MySQLSyntaxErrorException|syntax error at or near|JdbcSQL)/i.test(res.body)) {
    return {
      pass: false,
      status: 'F',
      reason: `Lộ lỗi SQL/Database trong phản hồi (HTTP ${res.status})`
    }
  }

  if (probe.expect === 'ok') {
    if (res.status >= 200 && res.status < 300 && !bizErr) {
      return { pass: true, status: 'P', reason: `HTTP ${res.status} (${res.durationMs} ms) — Thành công` }
    }
    return {
      pass: false,
      status: 'F',
      reason: bizErr ? `HTTP ${res.status} nhưng báo lỗi: ${bizErr}` : `HTTP ${res.status} ${res.statusText}`
    }
  }

  if (probe.expect === 'auth_err') {
    if (res.status === 401 || res.status === 403) {
      return { pass: true, status: 'P', reason: `HTTP ${res.status} — Server chặn truy cập đúng` }
    }
    if (res.status >= 400 && res.status < 500) {
      return { pass: true, status: 'P', reason: `HTTP ${res.status} — Server từ chối yêu cầu` }
    }
    if (bizErr) {
      return { pass: true, status: 'P', reason: `HTTP ${res.status} · Chặn ở tầng nghiệp vụ (${bizErr})` }
    }
    return {
      pass: false,
      status: 'F',
      reason: `Lỗ hổng bảo mật: Không có token hợp lệ nhưng Server vẫn trả thành công (HTTP ${res.status})!`
    }
  }

  // probe.expect === 'val_err'
  if (probe.kind === 'Injection') {
    // For special chars / injection, as long as it didn't 500 or leak SQL (checked above),
    // either rejecting (4xx/bizErr) or safely escaping is acceptable if not reflected raw HTML.
    if (res.status >= 400 && res.status < 500) {
      return { pass: true, status: 'P', reason: `HTTP ${res.status} — Server chặn dữ liệu chứa ký tự đặc biệt` }
    }
    if (bizErr) {
      return { pass: true, status: 'P', reason: `Server từ chối hợp lệ (${bizErr})` }
    }
    return { pass: true, status: 'P', reason: `HTTP ${res.status} — Server xử lý an toàn, không sập 500 / không lộ lỗi SQL` }
  }

  if (res.status >= 400 && res.status < 500) {
    return { pass: true, status: 'P', reason: `HTTP ${res.status} — Server từ chối dữ liệu sai/thiếu đúng kỳ vọng` }
  }
  if (bizErr) {
    return { pass: true, status: 'P', reason: `HTTP ${res.status} · Báo lỗi hợp lệ: ${bizErr}` }
  }
  return {
    pass: false,
    status: 'F',
    reason: `Thiếu validate Backend: Dữ liệu sai/thiếu nhưng Server vẫn trả thành công (HTTP ${res.status})!`
  }
}

/* ------------------------------------------- environment vars & Postman I/O */

/** Extract live variables ({{token}}, {{baseUrl}}, {{cookie}}) from recent device calls. */
export function liveVarsOf(calls: NetCall[]): Record<string, string> {
  const out: Record<string, string> = {}
  const recent = [...calls].filter((c) => c.kind === 'http').sort((a, b) => b.startedAt - a.startedAt)
  for (const c of recent) {
    if (!out.baseUrl) {
      const m = /^(https?:\/\/[^/]+)/i.exec(c.url)
      if (m) {
        out.baseUrl = m[1]
        out.base_url = m[1]
      }
    }
    for (const h of c.reqHeaders ?? []) {
      const k = h.name.toLowerCase()
      if (k === 'authorization' && h.value && !out.token) {
        out.auth = h.value
        out.token = h.value.replace(/^bearer\s+/i, '').trim()
        out.access_token = out.token
      } else if (k === 'cookie' && h.value && !out.cookie) {
        out.cookie = h.value
      } else if ((k === 'x-access-token' || k === 'x-auth-token' || k === 'token') && h.value && !out.token) {
        out.token = h.value.trim()
        out.access_token = out.token
      }
    }
  }
  return out
}

/** Substitute {{varName}} placeholders in URL, headers and body using live + custom variables. */
export function resolveEnvVars(req: ApiRequest, customVars: Record<string, string> = {}, calls: NetCall[] = []): ApiRequest {
  const all: Record<string, string> = { ...liveVarsOf(calls), ...customVars }
  const sub = (s: string): string => s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => (all[k] !== undefined && all[k] !== '' ? all[k] : m))
  return {
    ...req,
    url: sub(req.url),
    headers: req.headers.map((h) => ({ ...h, name: sub(h.name), value: sub(h.value) })),
    body: sub(req.body)
  }
}

interface PostmanUrl {
  raw?: string
  protocol?: string
  host?: string[] | string
  path?: string[] | string
}

interface PostmanItem {
  name?: string
  item?: PostmanItem[]
  request?: {
    method?: string
    header?: { key?: string; value?: string; disabled?: boolean }[]
    url?: string | PostmanUrl
    body?: {
      mode?: string
      raw?: string
      urlencoded?: { key?: string; value?: string; disabled?: boolean }[]
    }
  }
}

function extractPostmanUrl(u: string | PostmanUrl | undefined): string {
  if (!u) return ''
  if (typeof u === 'string') return u
  if (u.raw) return u.raw
  const proto = u.protocol ? `${u.protocol}://` : 'https://'
  const host = Array.isArray(u.host) ? u.host.join('.') : (u.host ?? '')
  const path = Array.isArray(u.path) ? u.path.join('/') : (u.path ?? '')
  return host ? `${proto}${host}${path ? `/${path.replace(/^\//, '')}` : ''}` : ''
}

/** Import requests and variables from either a Postman Collection v2.x OR a Swagger 2.0 / OpenAPI 3.x JSON string. */
export function importPostmanCollection(jsonText: string, pkg?: string): { name: string; items: SavedApiItem[]; vars: Record<string, string> } {
  const raw = JSON.parse(jsonText) as Record<string, unknown>
  if (raw && (typeof raw.openapi === 'string' || typeof raw.swagger === 'string') && raw.paths && typeof raw.paths === 'object') {
    return importOpenApiSpec(jsonText, pkg)
  }

  const root = raw as {
    info?: { name?: string }
    item?: PostmanItem[]
    variable?: { key?: string; value?: string; disabled?: boolean }[]
  }
  if (!root || !Array.isArray(root.item)) {
    throw new Error('File không đúng định dạng Postman Collection v2.x hoặc Swagger / OpenAPI JSON')
  }

  const vars: Record<string, string> = {}
  for (const v of root.variable ?? []) {
    if (v.key && !v.disabled && v.value !== undefined) vars[v.key] = String(v.value)
  }

  const items: SavedApiItem[] = []
  let seq = 0
  const walk = (list: PostmanItem[], prefix = ''): void => {
    for (const it of list) {
      const label = prefix ? `${prefix} / ${it.name || 'API'}` : (it.name || 'API')
      if (Array.isArray(it.item)) {
        walk(it.item, label)
        continue
      }
      if (!it.request) continue
      const r = it.request
      const method = (r.method || 'GET').toUpperCase()
      const url = extractPostmanUrl(r.url)
      if (!url) continue
      const headers: ApiHeader[] = (r.header ?? [])
        .filter((h) => h.key && !DROP_HEADERS.test(h.key))
        .map((h) => ({ name: h.key!, value: h.value ?? '', enabled: !h.disabled }))
      let body = ''
      if (r.body?.mode === 'raw' && r.body.raw) {
        body = r.body.raw
        try {
          body = JSON.stringify(JSON.parse(body), null, 2)
        } catch {
          /* keep raw */
        }
      } else if (r.body?.mode === 'urlencoded' && Array.isArray(r.body.urlencoded)) {
        const sp = new URLSearchParams()
        for (const p of r.body.urlencoded) {
          if (p.key && !p.disabled) sp.append(p.key, p.value ?? '')
        }
        body = sp.toString()
      }
      items.push({
        id: `pm-${Date.now()}-${++seq}`,
        name: label,
        pkg,
        req: { method, url, headers, body },
        updatedAt: Date.now()
      })
    }
  }
  walk(root.item)
  return { name: root.info?.name || 'Postman Collection', items, vars }
}

/** Export saved API requests into a Postman Collection v2.1.0 JSON string. */
export function exportPostmanCollection(name: string, items: SavedApiItem[], vars: Record<string, string> = {}): string {
  const col = {
    info: {
      name: name || 'ADB Kit API Collection',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: items.map((it) => ({
      name: it.name,
      request: {
        method: it.req.method,
        header: it.req.headers.map((h) => ({
          key: h.name,
          value: h.value,
          disabled: !h.enabled
        })),
        url: {
          raw: it.req.url
        },
        ...(it.req.body.trim()
          ? {
              body: {
                mode: 'raw',
                raw: it.req.body,
                options: { raw: { language: 'json' } }
              }
            }
          : {})
      }
    })),
    variable: Object.entries(vars).map(([key, value]) => ({ key, value, type: 'string' }))
  }
  return JSON.stringify(col, null, 2)
}

/* ------------------------------------------- OpenAPI / Swagger 2.0 & 3.x import */

interface OpenApiSchema {
  $ref?: string
  type?: string
  properties?: Record<string, OpenApiSchema>
  items?: OpenApiSchema
  example?: unknown
  default?: unknown
  enum?: unknown[]
}

function resolveSchemaRef(root: Record<string, unknown>, ref: string): OpenApiSchema | null {
  if (!ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  let cur: unknown = root
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur && typeof cur === 'object' ? (cur as OpenApiSchema) : null
}

function sampleFromSchema(root: Record<string, unknown>, schema: OpenApiSchema | undefined, depth = 0): unknown {
  if (!schema || depth > 4) return 'string'
  if (schema.$ref) {
    const target = resolveSchemaRef(root, schema.$ref)
    return target ? sampleFromSchema(root, target, depth + 1) : {}
  }
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if (schema.type === 'object' || schema.properties) {
    const obj: Record<string, unknown> = {}
    for (const [k, prop] of Object.entries(schema.properties ?? {})) {
      obj[k] = sampleFromSchema(root, prop, depth + 1)
    }
    return obj
  }
  if (schema.type === 'array') {
    return [sampleFromSchema(root, schema.items, depth + 1)]
  }
  if (schema.type === 'integer' || schema.type === 'number') return 1
  if (schema.type === 'boolean') return true
  return 'string'
}

/** Import endpoints and sample payloads from a Swagger 2.0 or OpenAPI 3.x JSON specification. */
export function importOpenApiSpec(jsonText: string, pkg?: string): { name: string; items: SavedApiItem[]; vars: Record<string, string> } {
  const root = JSON.parse(jsonText) as Record<string, unknown>
  const info = (root.info ?? {}) as { title?: string }
  const paths = (root.paths ?? {}) as Record<string, Record<string, unknown>>
  if (!paths || typeof paths !== 'object') {
    throw new Error('Không tìm thấy danh sách paths trong file Swagger / OpenAPI')
  }

  const vars: Record<string, string> = {}
  const servers = root.servers as { url?: string }[] | undefined
  if (Array.isArray(servers) && servers[0]?.url) {
    vars.baseUrl = servers[0].url.replace(/\/+$/, '')
  } else if (typeof root.host === 'string') {
    const scheme = Array.isArray(root.schemes) && typeof root.schemes[0] === 'string' ? root.schemes[0] : 'https'
    const bp = typeof root.basePath === 'string' ? root.basePath.replace(/\/+$/, '') : ''
    vars.baseUrl = `${scheme}://${root.host}${bp}`
  }

  const items: SavedApiItem[] = []
  let seq = 0
  const httpMethods = ['get', 'post', 'put', 'patch', 'delete']

  for (const [p, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== 'object') continue
    for (const m of httpMethods) {
      const op = ops[m] as {
        summary?: string
        operationId?: string
        tags?: string[]
        parameters?: { name?: string; in?: string; required?: boolean; schema?: OpenApiSchema; type?: string }[]
        requestBody?: { content?: Record<string, { schema?: OpenApiSchema; example?: unknown }> }
      } | undefined
      if (!op || typeof op !== 'object') continue

      const method = m.toUpperCase()
      const tag = Array.isArray(op.tags) && op.tags[0] ? `${op.tags[0]} / ` : ''
      const label = `${tag}${op.summary || op.operationId || `${method} ${p}`}`

      const query = new URLSearchParams()
      let bodySchema: OpenApiSchema | undefined
      let bodyExample: unknown

      for (const param of op.parameters ?? []) {
        if (param.in === 'query' && param.name) {
          query.set(param.name, param.type === 'integer' || param.type === 'number' ? '1' : 'test')
        } else if (param.in === 'body' && param.schema) {
          bodySchema = param.schema
        }
      }

      if (op.requestBody?.content) {
        const jsonMedia = op.requestBody.content['application/json'] ?? Object.values(op.requestBody.content)[0]
        if (jsonMedia) {
          bodySchema = jsonMedia.schema
          bodyExample = jsonMedia.example
        }
      }

      const qs = query.toString()
      const url = `{{baseUrl}}${p.startsWith('/') ? '' : '/'}${p}${qs ? `?${qs}` : ''}`
      const headers: ApiHeader[] = [
        { name: 'Accept', value: 'application/json', enabled: true },
        { name: 'Authorization', value: 'Bearer {{token}}', enabled: true }
      ]

      let body = ''
      if (!/^(GET|HEAD)$/i.test(method) && (bodyExample !== undefined || bodySchema)) {
        headers.unshift({ name: 'Content-Type', value: 'application/json', enabled: true })
        const sample = bodyExample !== undefined ? bodyExample : sampleFromSchema(root, bodySchema)
        body = typeof sample === 'string' ? sample : JSON.stringify(sample, null, 2)
      }

      items.push({
        id: `oas-${Date.now()}-${++seq}`,
        name: label,
        pkg,
        req: { method, url, headers, body },
        updatedAt: Date.now()
      })
    }
  }

  return { name: info.title || 'Swagger / OpenAPI', items, vars }
}

/* ------------------------------------------- Direct Auth / Token & Variable Extraction */

/** Read a dotted path (e.g. "data.accessToken" or "result.user.id") from a JSON response string. */
export function extractJsonByPath(body: string, dotPath: string): string | null {
  const json = parseJsonBody(body)
  if (!json || !dotPath.trim()) return null
  const val = getAtPath(json, dotPath.trim())
  if (val === undefined || val === null) return null
  return typeof val === 'object' ? JSON.stringify(val) : String(val)
}

/**
 * Automatically locate a JWT / access token inside a Login API JSON response body
 * (looks for access_token, accessToken, token, jwt, id_token at top-level or inside data/result).
 */
export function autoFindTokenInResponse(body: string, customPath?: string): { path: string; token: string } | null {
  if (customPath?.trim()) {
    const v = extractJsonByPath(body, customPath.trim())
    if (v) return { path: customPath.trim(), token: v.replace(/^bearer\s+/i, '').trim() }
  }
  const json = parseJsonBody(body)
  if (!json) return null

  const candidates = [
    'access_token',
    'accessToken',
    'token',
    'jwt',
    'id_token',
    'idToken',
    'data.access_token',
    'data.accessToken',
    'data.token',
    'data.jwt',
    'result.access_token',
    'result.accessToken',
    'result.token',
    'payload.token',
    'response.token'
  ]
  for (const p of candidates) {
    const v = getAtPath(json, p)
    if (typeof v === 'string' && v.trim().length >= 8) {
      return { path: p, token: v.replace(/^bearer\s+/i, '').trim() }
    }
  }
  return null
}

/** Flatten scalar fields of a JSON response so the tester can click any field to save into {{var}}. */
export function flattenJsonLeaves(body: string, maxItems = 24): { path: string; shortKey: string; value: string }[] {
  const json = parseJsonBody(body)
  if (!json) return []
  const paths = jsonPaths(json)
  const out: { path: string; shortKey: string; value: string }[] = []
  for (const p of paths) {
    if (out.length >= maxItems) break
    const v = getAtPath(json, p)
    if (v === null || v === undefined || typeof v === 'object') continue
    const str = String(v)
    if (!str.trim()) continue
    const shortKey = p.split('.').pop() || p
    out.push({ path: p, shortKey, value: str })
  }
  return out
}


