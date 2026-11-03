// Test-automation model shared by the recorder (renderer) and the runner (main).
// All screen coordinates are normalized to [0, 1] so scripts survive resolution changes.

/** How `text` / `desc` are compared. */
export type MatchMode = 'exact' | 'contains' | 'prefix'

export interface Selector {
  id?: string // resource-id, e.g. "com.app:id/login"
  text?: string
  desc?: string // content-desc
  match?: MatchMode // default: exact
}

export interface UiNode {
  id: string
  text: string
  desc: string
  cls: string
  pkg: string
  clickable: boolean
  /** Normalized bounds [x1, y1, x2, y2]. */
  b: [number, number, number, number]
  /** Index of the nearest visible ancestor in the same list (-1 = root). */
  parent?: number
  enabled?: boolean
}

export type Step =
  | { type: 'tap'; x: number; y: number; target?: Selector }
  | { type: 'tapIf'; target: Selector; timeoutMs: number }
  | { type: 'longpress'; x: number; y: number; ms: number; target?: Selector }
  | { type: 'swipe'; x1: number; y1: number; x2: number; y2: number; ms: number }
  | { type: 'scroll'; x: number; y: number; dy: number }
  | { type: 'text'; text: string }
  | { type: 'key'; code: number; name: string }
  | { type: 'wait'; ms: number }
  | { type: 'waitFor'; target: Selector; timeoutMs: number }
  | { type: 'assert'; target: Selector; visible: boolean }
  | { type: 'launch'; pkg: string; clear: boolean }
  | { type: 'stopApp'; pkg: string }
  | { type: 'screenshot'; label?: string }
  // Environment preparation
  | { type: 'network'; wifi?: 'on' | 'off'; data?: 'on' | 'off' }
  | { type: 'permission'; pkg: string; permission: string; grant: boolean }
  | { type: 'deeplink'; url: string }
  /** Wait for a one-time code to arrive in a notification (SMS…) and type it. */
  | { type: 'otp'; timeoutMs: number }
  | { type: 'shell'; cmd: string; expect?: string }
  // API checks (WebView HTTP + Tauri commands, captured through DevTools)
  | {
      type: 'api'
      /** Text the URL (HTTP) or command name (Tauri) must contain, e.g. "/login" or "plugin:sql". */
      match: string
      kind?: 'any' | 'http' | 'ipc'
      method?: string
      /** Expected HTTP status; 0 = any successful response (2xx/3xx, or Tauri ok). */
      status?: number
      /** Text that must appear in the response / result. */
      bodyContains?: string
      /** Only calls made after the previous action are considered; wait at most this long. */
      timeoutMs: number
      /** Assert that NO matching call happens. */
      absent?: boolean
    }
  // Visual check against a saved reference screenshot
  | {
      type: 'visual'
      /** Name of the reference image (one per screen / state). */
      name: string
      /** Allowed share of differing pixels, in percent. */
      tolerance: number
      /** Ignore the status bar (clock, battery…) and navigation bar. */
      ignoreBars: boolean
      /** Extra normalized regions to ignore [x1, y1, x2, y2] (e.g. a date, an ad). */
      masks?: [number, number, number, number][]
    }
  // Fake API behaviour (WebView HTTP through DevTools, Tauri commands through the IPC hook)
  | { type: 'mock'; rule: MockRule }
  | { type: 'mockClear' }
  /** Reload the app's WebView (restart its UI) — startup calls then go through active mocks. */
  | { type: 'reloadWebView' }
  /**
   * Performance threshold:
   *  startup = last "launch" time (ms) · memory = current app memory (MB)
   *  cpu = average CPU since the previous action (% of one core) · jank = janky frames since run start (%)
   */
  | { type: 'perf'; metric: 'startup' | 'memory' | 'cpu' | 'jank'; max: number }
  // Permission checks / special permissions
  | { type: 'permCheck'; pkg: string; permission: string; expect: 'granted' | 'denied' }
  | { type: 'permRevokeAll'; pkg: string }
  | { type: 'appop'; pkg: string; op: string; mode: 'allow' | 'ignore' | 'deny' | 'default' }

export interface Script {
  version: 1
  name: string
  /** App under test: used by "launch" defaults and to attribute crashes. */
  app: string
  steps: Step[]
  /** KBKT "Mục đích kiểm thử" (defaults to the name). */
  purpose?: string
  /** KBKT "Kết quả mong muốn" (defaults to a summary of the checks). */
  expected?: string
}

/* ------------------------------------------------------------------ suites */

export interface SuiteItem {
  /** Absolute path of the script (.json) — stored relative to the suite file on disk. */
  path: string
  /** KBKT group header (yellow row). */
  group?: string
  /** Optional CSV: one test case per row, `${column}` placeholders in steps. */
  data?: string
  enabled: boolean
}

export interface Suite {
  kind: 'adbkit-suite'
  version: 1
  name: string
  /** KBKT "Mã trường hợp kiểm thử" prefix, e.g. MYENG_HOMNAY. */
  code: string
  author: string
  tester: string
  /** Re-run failed cases this many times (KQ lần 2 / lần 3). */
  retries: number
  /** Force-stop the app under test before every case so each starts from a clean state. */
  resetApp?: boolean
  items: SuiteItem[]
  /** KBKT template for the generated file: "BES", "BCCS" or a path to a custom template. */
  template?: string
  /** Test cases imported from an existing KBKT file; results are written back into a copy of it. */
  kbkt?: KbktImport
}

export interface KbktLink {
  sheet: string
  row: number
  code: string
  group: string
  purpose: string
  steps: string
  expected: string
  /** Result already present in the file. */
  prev: string
  /** Automated: script that verifies this test case. */
  script?: string
  /** Manual result entered by the tester. */
  manual?: '' | 'P' | 'F' | 'PE'
  note?: string
}

export interface KbktImport {
  file: string
  layout: 'BES' | 'BCCS'
  rows: KbktLink[]
}

export const kbktKey = (l: { sheet: string; row: number }): string => `${l.sheet}!${l.row}`

export const emptySuite = (): Suite => ({
  kind: 'adbkit-suite',
  version: 1,
  name: 'Bộ test mới',
  code: 'TC',
  author: '',
  tester: '',
  retries: 1,
  resetApp: true,
  items: []
})

export interface ScriptInfo {
  path: string
  name: string
  app: string
  steps: number
  error?: string
}

export type CaseState = 'pending' | 'running' | 'passed' | 'failed' | 'crashed' | 'stopped'

export interface CaseInfo {
  index: number
  title: string
  group: string
  /** Suite item index, or -1 for a case coming from the imported KBKT file. */
  item: number
  /** kbktKey of the imported row this case verifies. */
  kbkt?: string
}

/** Progress of one phone while a suite runs on several phones at once. */
export interface DeviceRun {
  serial: string
  model: string
  cases: string[]
  states: CaseState[]
  reports: (string | undefined)[]
  messages: string[]
  done: boolean
  passed: number
  failed: number
  html?: string
  error?: string
}

export type MultiEvent = { kind: 'progress'; devices: DeviceRun[] } | { kind: 'done'; devices: DeviceRun[]; html: string }

export type SuiteEvent =
  | { kind: 'start'; cases: CaseInfo[]; dir: string }
  | { kind: 'case'; index: number; attempt: number; state: CaseState; message?: string; report?: string }
  | { kind: 'run'; index: number; event: RunEvent }
  | {
      kind: 'end'
      passed: number
      failed: number
      total: number
      stopped: boolean
      html: string
      xlsx?: string
      /** Copy of the imported KBKT file with results written in. */
      kbktOut?: string
      error?: string
    }

/** Replace `${name}` placeholders in every string of a script with values from a data row. */
export function applyVars<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string')
    return value.replace(/\$\{([^}]+)\}/g, (m, k: string) => (k.trim() in vars ? vars[k.trim()] : m)) as T
  if (Array.isArray(value)) return value.map((v) => applyVars(v, vars)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = applyVars(v, vars)
    return out as T
  }
  return value
}

/** Minimal CSV parser: header row, `,` or `;` (auto), quoted fields, UTF-8 BOM. */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === delim) {
      row.push(cur)
      cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += c
  }
  if (cur || row.length) {
    row.push(cur)
    rows.push(row)
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim()))
  if (!header) return []
  const keys = header.map((h) => h.trim())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

/**
 * Does a shell command look like it writes / deletes / changes settings? Read-only commands
 * (getprop, dumpsys, pm list, ls, cat…) must not trigger warnings, or testers learn to
 * click through them.
 */
export function shellMayModify(cmd: string): boolean {
  return /(^|[\s;&|(])(rm|rmdir|mv|cp|dd|chmod|chown|setprop|reboot|mkdir|touch|kill|killall|svc|input|truncate|wipe)\b|\bpm\s+(clear|uninstall|install|disable|enable|grant|revoke|reset)|\bsettings\s+(put|delete|reset)|\bam\s+(start|force-stop|kill|broadcast|crash)|\bcmd\s+\w+\s+(set|put|reset|disable|enable)|>/.test(cmd)
}

/**
 * Steps that change data or settings on the device (asked for confirmation before a run):
 * wiping app data, revoking permissions, changing special permissions, turning networks
 * off, and arbitrary shell commands.
 */
export function destructiveSteps(s: Script): string[] {
  const out: string[] = []
  s.steps.forEach((st, i) => {
    const risky =
      (st.type === 'launch' && st.clear) ||
      st.type === 'permRevokeAll' ||
      (st.type === 'permission' && !st.grant) ||
      st.type === 'appop' ||
      (st.type === 'network' && (st.wifi === 'off' || st.data === 'off')) ||
      (st.type === 'shell' && shellMayModify(st.cmd))
    if (risky) out.push(`Bước ${i + 1}: ${describeStep(st)}`)
  })
  return out
}

/** KBKT "Kết quả mong muốn" when the script does not say it explicitly. */
export function expectedOf(s: Script): string {
  if (s.expected?.trim()) return s.expected.trim()
  const lines: string[] = []
  for (const st of s.steps) {
    if (st.type === 'assert') lines.push(`${selectorLabel(st.target)} ${st.visible ? 'hiển thị' : 'không hiển thị'}`)
    else if (st.type === 'waitFor') lines.push(`${selectorLabel(st.target)} xuất hiện trong ${Math.round(st.timeoutMs / 1000)} giây`)
    else if (st.type === 'shell' && st.expect) lines.push(`Lệnh "${st.cmd}" trả về có chứa "${st.expect}"`)
    else if (st.type === 'api')
      lines.push(
        st.absent
          ? `Không gọi API/lệnh chứa "${st.match}"`
          : `Gọi API/lệnh chứa "${st.match}"${st.method ? ` (${st.method.toUpperCase()})` : ''} ${st.status ? `trả về ${st.status}` : 'thành công'}${st.bodyContains ? `, kết quả chứa "${st.bodyContains}"` : ''}`
      )
    else if (st.type === 'permCheck') lines.push(`Quyền ${shortPerm(st.permission)} ${st.expect === 'granted' ? 'được cấp' : 'bị từ chối'}`)
    else if (st.type === 'visual') lines.push(`Màn hình giống ảnh chuẩn "${st.name}" (lệch ≤ ${st.tolerance}%)`)
    else if (st.type === 'perf') lines.push(`${PERF_LABEL[st.metric]} ≤ ${st.max} ${PERF_UNIT[st.metric]}`)
  }
  lines.push('App không crash / ANR trong suốt quá trình')
  return lines.map((l) => `- ${l}`).join('\n')
}

/** KBKT "Các bước thực hiện": numbered actions (plain waits and screenshots left out). */
export function stepsText(s: Script): string {
  return s.steps
    .filter((st) => st.type !== 'wait' && st.type !== 'screenshot')
    .map((st, i) => `${i + 1}. ${describeStep(st)}`)
    .join('\n')
}

export interface RunOptions {
  repeat: number
  /** Find recorded elements again before tapping (robust, ~2s per tap). */
  smartTargets: boolean
  stopOnCrash: boolean
  stopOnFailure: boolean
  /** Multiplier for recorded waits; 0.5 = twice as fast. */
  speed: number
  /** Record the device screen during the run and attach the video to the report. */
  recordVideo: boolean
  /** Attach to the app's WebView (DevTools) and capture JS errors / failed requests. */
  webErrors: boolean
  /** Mark the run as failed when JS errors were captured. */
  failOnWebErrors: boolean
  /** Record HTTP calls and Tauri commands (WebView DevTools) for the report and "api" checks. */
  captureApi?: boolean
  /** Visual checks: overwrite the reference images with the current screen instead of comparing. */
  updateBaselines?: boolean
  /** Sample the app's memory / CPU, measure launch time and frame jank. */
  measurePerf?: boolean
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  repeat: 1,
  smartTargets: true,
  stopOnCrash: true,
  stopOnFailure: true,
  speed: 1,
  recordVideo: true,
  webErrors: true,
  failOnWebErrors: false,
  captureApi: true,
  measurePerf: true
}

/** A problem reported by the app's WebView through DevTools. */
export interface WebError {
  kind: 'exception' | 'console' | 'network' | 'log'
  message: string
  source?: string
  stack?: string
  /** Wall-clock time (ms since epoch). */
  at: number
  /** Step that was running, 1-based; 0 = before the first step. */
  step: number
  iteration: number
}

export type RunEvent =
  | { kind: 'start'; total: number; repeat: number }
  | { kind: 'step'; iteration: number; index: number; state: 'running' | 'ok' | 'failed' | 'warn'; message?: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { kind: 'crash'; type: 'crash' | 'anr' | 'native'; pkg: string; summary: string }
  | { kind: 'webError'; error: WebError }
  | { kind: 'report'; path: string; title: string; bug?: string }
  | { kind: 'end'; result: 'passed' | 'failed' | 'stopped' | 'crashed'; message: string }

export const emptyScript = (): Script => ({ version: 1, name: 'Test mới', app: '', steps: [] })

const MATCH_LABEL: Record<MatchMode, string> = { exact: '', contains: 'chứa ', prefix: 'bắt đầu bằng ' }

export function selectorLabel(s: Selector): string {
  const m = MATCH_LABEL[s.match ?? 'exact']
  const parts: string[] = []
  if (s.text) parts.push(`${m}"${s.text}"`)
  if (s.desc) parts.push(`mô tả ${m}"${s.desc}"`)
  if (s.id) parts.push(`#${s.id.split(':id/').pop()}`)
  return parts.join(' ') || '(bất kỳ)'
}

const pct = (v: number): string => `${Math.round(v * 100)}%`

export const PERF_LABEL = { startup: 'thời gian mở app', memory: 'RAM của app', cpu: 'CPU trung bình', jank: 'tỉ lệ khung hình giật' } as const
export const PERF_UNIT = { startup: 'ms', memory: 'MB', cpu: '%', jank: '%' } as const
export const shortPerm = (p: string): string => p.replace(/^android\.permission\./, '')

/* ------------------------------------------------------------------ mocks */

/**
 * Replace the outcome of matching calls, to test how the app handles failures:
 *  - status : answer with this HTTP status / body (Tauri command: resolve with the body)
 *  - error  : fail the call (HTTP: network error; Tauri command: reject with the body)
 *  - delay  : let it through after `delayMs` (slow network / slow backend)
 */
export interface MockRule {
  match: string
  kind: 'any' | 'http' | 'ipc'
  action: 'status' | 'error' | 'delay'
  status?: number
  body?: string
  delayMs?: number
}

/**
 * Bad network for every API call of the app (WebView fetch/XHR, mini-app WVFetch, Tauri HTTP):
 * slow = each call delayed; flaky = some calls fail, the rest random delays; offline = all fail.
 */
export interface NetProfile {
  mode: 'slow' | 'flaky' | 'offline'
  delayMs: number
  failRate: number
}
export const NET_PROFILES: Record<NetProfile['mode'], { label: string; profile: NetProfile }> = {
  slow: { label: 'Chậm (như 3G yếu)', profile: { mode: 'slow', delayMs: 2500, failRate: 0 } },
  flaky: { label: 'Chập chờn (30% lỗi, trễ ngẫu nhiên)', profile: { mode: 'flaky', delayMs: 3000, failRate: 0.3 } },
  offline: { label: 'Mất mạng (mọi API lỗi)', profile: { mode: 'offline', delayMs: 0, failRate: 1 } }
}

export function describeMock(r: MockRule): string {
  const what = r.kind === 'ipc' ? 'lệnh' : r.kind === 'http' ? 'API' : 'API/lệnh'
  const act =
    r.action === 'error'
      ? 'lỗi mạng / bị từ chối'
      : r.action === 'delay'
        ? `chậm ${Math.round((r.delayMs ?? 0) / 100) / 10} giây`
        : `trả về ${r.status ?? 200}${r.body ? ` "${r.body.slice(0, 40)}"` : ''}`
  return `${what} chứa "${r.match}" → ${act}`
}

/* ---------------------------------------------------------------- network */

/** One observed call: an HTTP request from the WebView, or a Tauri command (JS → Rust). */
export interface NetCall {
  id: string
  kind: 'http' | 'ipc'
  /** HTTP method, or "invoke" for Tauri commands. */
  method: string
  /** URL, or the Tauri command name (e.g. plugin:sql|select). */
  url: string
  /** Request body / command arguments (clipped). */
  args?: string
  /** HTTP status; for commands 200 = ok, 500 = rejected. undefined while pending. */
  status?: number
  error?: string
  /** Response body / command result (clipped). */
  result?: string
  resourceType?: string
  /** Made by Tauri's HTTP plugin from Rust (decoded from plugin:http commands). */
  viaTauri?: boolean
  /** Outcome was faked by an ADB Kit mock rule (action name). */
  mocked?: string
  /**
   * chucker: read from the app's Chucker database (native OkHttp app);
   * bridge: a mini-app's call to the native bridge (Capacitor / WindVane), incl. WVFetch HTTP.
   */
  source?: 'chucker' | 'bridge'
  /** Page (mini-app) that made the call: its title or URL. */
  page?: string
  reqHeaders?: { name: string; value: string }[]
  resHeaders?: { name: string; value: string }[]
  startedAt: number
  durationMs?: number
  step?: number
  iteration?: number
}

export const callFailed = (c: NetCall): boolean => !!c.error || (c.status !== undefined && (c.status === 0 || c.status >= 400))

/* ------------------------------------------------------------- permissions */

export interface PermissionInfo {
  name: string
  kind: 'runtime' | 'install' | 'special'
  granted: boolean | null
  /** App-op mode for special permissions (allow / ignore / deny / default…). */
  mode?: string
  /** App-op used for this permission, if any (to toggle / read last use). */
  op?: string
  flags?: string
  /** Human text such as "3 giờ trước" when the app last used it. */
  lastUsed?: string
  lastUsedMs?: number
}
const sec = (ms: number): string => `${Math.round(ms / 100) / 10} giây`

export function describeStep(s: Step): string {
  switch (s.type) {
    case 'tap':
      return s.target ? `Bấm ${selectorLabel(s.target)}` : `Bấm tại ${pct(s.x)}, ${pct(s.y)}`
    case 'tapIf':
      return `Nếu thấy ${selectorLabel(s.target)} thì bấm (chờ ≤ ${sec(s.timeoutMs)})`
    case 'longpress':
      return `Nhấn giữ ${s.target ? selectorLabel(s.target) : `tại ${pct(s.x)}, ${pct(s.y)}`} (${s.ms} ms)`
    case 'swipe':
      return `Vuốt ${pct(s.x1)},${pct(s.y1)} → ${pct(s.x2)},${pct(s.y2)} (${s.ms} ms)`
    case 'scroll':
      return `Cuộn ${s.dy > 0 ? 'lên' : 'xuống'} ×${Math.abs(s.dy)} tại ${pct(s.x)}, ${pct(s.y)}`
    case 'text':
      return `Nhập "${s.text}"`
    case 'key':
      return `Phím ${s.name}`
    case 'wait':
      return `Chờ ${s.ms} ms`
    case 'waitFor':
      return `Chờ xuất hiện ${selectorLabel(s.target)} (≤ ${sec(s.timeoutMs)})`
    case 'assert':
      return `Kiểm tra ${selectorLabel(s.target)} ${s.visible ? 'có hiển thị' : 'KHÔNG hiển thị'}`
    case 'launch':
      return `Mở app ${s.pkg}${s.clear ? ' (xóa dữ liệu trước)' : ''}`
    case 'stopApp':
      return `Tắt hẳn app ${s.pkg}`
    case 'screenshot':
      return `Chụp màn hình${s.label ? ` "${s.label}"` : ''}`
    case 'network': {
      const p: string[] = []
      if (s.wifi) p.push(`Wi-Fi ${s.wifi === 'on' ? 'BẬT' : 'TẮT'}`)
      if (s.data) p.push(`dữ liệu di động ${s.data === 'on' ? 'BẬT' : 'TẮT'}`)
      return `Mạng: ${p.join(', ') || '(không đổi)'}`
    }
    case 'permission':
      return `${s.grant ? 'Cấp' : 'Thu hồi'} quyền ${s.permission.replace('android.permission.', '')} cho ${s.pkg}`
    case 'deeplink':
      return `Mở link ${s.url}`
    case 'otp':
      return `Chờ mã OTP trong thông báo (≤ ${sec(s.timeoutMs)}) rồi điền`
    case 'shell':
      return `Lệnh adb shell: ${s.cmd}${s.expect ? ` (phải chứa "${s.expect}")` : ''}`
    case 'api': {
      const what = s.kind === 'ipc' ? 'lệnh Tauri' : s.kind === 'http' ? 'API HTTP' : 'API/lệnh'
      if (s.absent) return `Kiểm tra KHÔNG gọi ${what} chứa "${s.match}" (trong ${sec(s.timeoutMs)})`
      const cond: string[] = []
      if (s.method) cond.push(s.method.toUpperCase())
      if (s.status) cond.push(`status ${s.status}`)
      else cond.push('thành công')
      if (s.bodyContains) cond.push(`kết quả chứa "${s.bodyContains}"`)
      return `Kiểm tra gọi ${what} chứa "${s.match}" — ${cond.join(', ')} (≤ ${sec(s.timeoutMs)})`
    }
    case 'visual':
      return `So sánh màn hình với ảnh chuẩn "${s.name}" (lệch tối đa ${s.tolerance}%)`
    case 'mock':
      return `Giả lập: ${describeMock(s.rule)}`
    case 'mockClear':
      return 'Bỏ mọi giả lập API'
    case 'reloadWebView':
      return 'Tải lại giao diện app (WebView)'
    case 'perf':
      return `Kiểm tra hiệu năng: ${PERF_LABEL[s.metric]} ≤ ${s.max} ${PERF_UNIT[s.metric]}`
    case 'permCheck':
      return `Kiểm tra quyền ${shortPerm(s.permission)} của ${s.pkg} đang ${s.expect === 'granted' ? 'ĐƯỢC CẤP' : 'BỊ TỪ CHỐI'}`
    case 'permRevokeAll':
      return `Thu hồi tất cả quyền runtime của ${s.pkg}`
    case 'appop':
      return `Quyền đặc biệt ${s.op} của ${s.pkg} → ${s.mode}`
  }
}

/**
 * Smallest meaningful node under a normalized point. Containers covering half the screen
 * or more (e.g. "action_bar_root") are never a useful tap target: a selector for them
 * always matches and would tap the wrong place, so the step stays position-only instead.
 * (WebViews expose their element tree only after the first accessibility dump, so an early
 * dump may contain nothing but such containers.)
 */
export function nodeAt(nodes: UiNode[], x: number, y: number): UiNode | null {
  let best: UiNode | null = null
  let bestArea = Infinity
  for (const n of nodes) {
    const [x1, y1, x2, y2] = n.b
    if (x < x1 || x > x2 || y < y1 || y > y2) continue
    if (!n.id && !n.text && !n.desc && !n.clickable) continue
    const area = (x2 - x1) * (y2 - y1)
    if (area >= 0.5) continue
    if (area > 0 && area < bestArea) {
      best = n
      bestArea = area
    }
  }
  return best
}

export function selectorFor(n: UiNode): Selector | undefined {
  const s: Selector = {}
  if (n.id) s.id = n.id
  // "5 Từ vựng": a counter badge glued to the label changes over time — match the label.
  const badge = /^\d+\s+(\S.*)$/.exec(n.text) ?? /^(.*\S)\s+\d+$/.exec(n.text)
  if (badge) {
    s.text = badge[1]
    s.match = 'contains'
  } else if (n.text) s.text = n.text
  if (n.desc) s.desc = n.desc
  return s.id || s.text || s.desc ? s : undefined
}

function textMatches(actual: string, wanted: string | undefined, mode: MatchMode): boolean {
  if (!wanted) return true
  const a = actual.trim().toLowerCase()
  const w = wanted.trim().toLowerCase()
  if (mode === 'contains') return a.includes(w)
  if (mode === 'prefix') return a.startsWith(w)
  return actual === wanted
}

export function matches(n: UiNode, s: Selector): boolean {
  const mode = s.match ?? 'exact'
  return (!s.id || n.id === s.id) && textMatches(n.text, s.text, mode) && textMatches(n.desc, s.desc, mode)
}

/**
 * Best node for a selector. With loose matching ("contains"/"prefix") several nodes can
 * match — e.g. "Cài đặt" inside a long paragraph — so rank: exact text first, then
 * clickable elements, then the one closest to the recorded point.
 */
export function findNode(nodes: UiNode[], s: Selector, near?: { x: number; y: number }): UiNode | null {
  const hits = nodes.filter((n) => matches(n, s))
  if (hits.length <= 1) return hits[0] ?? null
  const wanted = (s.text ?? s.desc ?? '').trim().toLowerCase()
  const rank = (n: UiNode): number => {
    const t = (s.text ? n.text : n.desc).trim().toLowerCase()
    const exact = t === wanted ? 0 : 1
    const short = t.length <= wanted.length + 12 ? 0 : 1 // a label, not a paragraph
    const click = n.clickable ? 0 : 1
    let dist = 0
    if (near) {
      const cx = (n.b[0] + n.b[2]) / 2
      const cy = (n.b[1] + n.b[3]) / 2
      dist = Math.min(0.99, (cx - near.x) ** 2 + (cy - near.y) ** 2)
    }
    return exact * 8 + short * 4 + click * 2 + dist
  }
  return hits.reduce((a, b) => (rank(b) < rank(a) ? b : a))
}
