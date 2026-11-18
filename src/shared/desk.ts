// "Bảng theo dõi": the phone shows live information about this PC (read-only display).

export interface DeskWidgets {
  clock: boolean
  cpu: boolean
  ram: boolean
  /** Tokens used by AI coding tools on this PC (Claude Code, Antigravity), read from their local logs. */
  ai: boolean
  gpu: boolean
  /** Download / upload speed of the PC. */
  net: boolean
  /** Laptop battery (nothing is shown on a PC without one). */
  battery: boolean
  /** The track that is playing on the PC. */
  media: boolean
  /** Latest GitHub Actions run of `ciRepo`. */
  ci: boolean
}

export const WIDGET_IDS: (keyof DeskWidgets)[] = ['clock', 'cpu', 'ram', 'gpu', 'net', 'battery', 'media', 'ai', 'ci']

export interface DeskConfig {
  widgets: DeskWidgets
  /** "owner/repo" on GitHub whose latest Actions run is shown; '' = none. */
  ciRepo: string
  /** Brightness of the page in percent (30–100); lower is kinder to an old screen. */
  dim: number
  /** After the page opens, ADB Kit taps the middle of the screen once so the browser goes full screen. */
  autoFull: boolean
  /**
   * 'app': ADB Kit installs its small viewer app on the phone (true full screen, screen kept on).
   * 'browser': nothing is installed; the page opens in the phone's browser.
   */
  via: DeskVia
  /** When ADB Kit is closed while the board is on, also put the phone's screen to sleep. */
  sleepOnQuit: boolean
  /**
   * Viewer app only: once the board is up, lock the phone (screen off, then on again). The board
   * stays visible on top of the lock screen; anything else on the phone asks for the PIN.
   */
  lockPhone: boolean
}

export type DeskVia = 'app' | 'browser'

export const DEFAULT_DESK: DeskConfig = {
  widgets: { clock: true, cpu: true, ram: true, ai: true, gpu: true, net: true, battery: true, media: true, ci: true },
  ciRepo: '',
  dim: 100,
  autoFull: true,
  via: 'app',
  sleepOnQuit: true,
  lockPhone: false
}

/** "owner/repo" from what the user typed (a GitHub link works too), or '' when it is not one. */
export function normalizeRepo(text: unknown): string {
  if (typeof text !== 'string') return ''
  const t = text.trim()
  const m =
    /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(t) ??
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$/.exec(t)
  return m ? `${m[1]}/${m[2]}` : ''
}

/** The viewer app bundled as resources/adbkit-desk.apk (built from android/desk). */
export const DESK_APP = { pkg: 'dev.adbkit.desk', activity: 'dev.adbkit.desk/.MainActivity', versionCode: 4 }

/** versionCode of an installed package from `dumpsys package <pkg>`, or null when it is not installed. */
export function installedVersion(dumpsys: string): number | null {
  const m = /versionCode=(\d+)/.exec(dumpsys)
  return m ? Number(m[1]) : null
}

/** Middle of the screen from `wm size` output (the override size wins when there is one). */
export function screenCenter(wmSize: string): { x: number; y: number } | null {
  const all = [...wmSize.matchAll(/(\d+)x(\d+)/g)]
  const m = all[all.length - 1]
  return m ? { x: Math.round(Number(m[1]) / 2), y: Math.round(Number(m[2]) / 2) } : null
}

export function normalizeDesk(c: Partial<DeskConfig> | null | undefined): DeskConfig {
  const w: Partial<DeskWidgets> = c?.widgets ?? {}
  const dim = Number(c?.dim)
  const widgets = { ...DEFAULT_DESK.widgets }
  for (const id of WIDGET_IDS) if (typeof w[id] === 'boolean') widgets[id] = w[id]
  return {
    widgets,
    ciRepo: normalizeRepo(c?.ciRepo),
    dim: Number.isFinite(dim) ? Math.min(100, Math.max(30, Math.round(dim))) : DEFAULT_DESK.dim,
    autoFull: c?.autoFull ?? DEFAULT_DESK.autoFull,
    via: c?.via === 'browser' || c?.via === 'app' ? c.via : DEFAULT_DESK.via,
    sleepOnQuit: c?.sleepOnQuit ?? DEFAULT_DESK.sleepOnQuit,
    lockPhone: c?.lockPhone === true
  }
}

export interface TokenSum {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Number of model replies counted. */
  messages: number
}

export const emptySum = (): TokenSum => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 })

export interface AiUsage {
  /** Since local midnight. */
  today: TokenSum
  /** The last five hours. */
  recent: TokenSum
  /** Sessions that wrote a reply in the last five minutes. */
  active: number
}

export interface DeskSnapshot {
  t: number
  host: string
  /** 0–100 across all cores; undefined until two samples exist. */
  cpu?: number
  cores: number
  memUsed: number
  memTotal: number
  /** One entry per AI tool that keeps usage logs on this PC; undefined while hidden or not read yet. */
  ai?: AiSourceUsage[]
  gpu?: GpuLoad
  net?: NetRate
  battery?: Battery
  media?: Media
  ci?: CiRun
}

export interface GpuLoad {
  name: string
  /** 0–100, the busiest kind of GPU work (what Task Manager shows). */
  load: number
}
/** Bytes per second. */
export interface NetRate {
  down: number
  up: number
}
export interface Battery {
  level: number
  charging: boolean
}
export interface Media {
  title: string
  artist: string
  playing: boolean
  /** Seconds; 0 when the player does not say. */
  position: number
  duration: number
  /** False when the player refuses "previous" / "next" (a single video, a live stream); unset when unknown. */
  canPrev?: boolean
  canNext?: boolean
}
export type CiState = 'success' | 'failure' | 'running' | 'queued' | 'cancelled' | 'other'
export interface CiRun {
  repo: string
  state: CiState
  /** Workflow name. */
  name: string
  /** What triggered it (usually the commit message's first line). */
  title: string
  branch: string
  /** Last update of the run, epoch ms. */
  at: number
}

/** Cumulative network byte counters of the PC. */
export interface NetCounters {
  rx: number
  tx: number
}
/** What the platform helper reports each tick (see resources/desk-helper.ps1). */
export interface SysSample {
  net?: NetCounters
  gpu?: GpuLoad
  battery?: Battery
  media?: Media
  /** The line only refreshes `media` (sent right after a media button); the other readings stay as they were. */
  mediaOnly?: boolean
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null)
const pct = (v: number): number => Math.min(100, Math.max(0, v))

/** One line printed by the helper; fields that are missing or malformed are dropped. */
export function parseSysLine(line: string): SysSample | null {
  let o: Record<string, unknown> | null
  try {
    o = obj(JSON.parse(line))
  } catch {
    return null
  }
  if (!o) return null
  const out: SysSample = {}
  const net = obj(o.net)
  if (net && finite(net.rx) && finite(net.tx)) out.net = { rx: net.rx, tx: net.tx }
  const gpu = obj(o.gpu)
  if (gpu && finite(gpu.load)) out.gpu = { name: typeof gpu.name === 'string' ? gpu.name : '', load: pct(gpu.load) }
  const bat = obj(o.battery)
  if (bat && finite(bat.level)) out.battery = { level: pct(bat.level), charging: bat.charging === true }
  const m = obj(o.media)
  if (m && typeof m.title === 'string' && m.title) {
    out.media = {
      title: m.title.slice(0, 200),
      artist: typeof m.artist === 'string' ? m.artist.slice(0, 200) : '',
      playing: m.playing === true,
      position: finite(m.position) && m.position > 0 ? m.position : 0,
      duration: finite(m.duration) && m.duration > 0 ? m.duration : 0
    }
    if (typeof m.canPrev === 'boolean') out.media.canPrev = m.canPrev
    if (typeof m.canNext === 'boolean') out.media.canNext = m.canNext
  }
  if (o.only === 'media') out.mediaOnly = true
  return out
}

/** Speed between two counter readings `ms` apart; undefined when the counters went backwards (adapter reset). */
export function netRate(prev: NetCounters, cur: NetCounters, ms: number): NetRate | undefined {
  if (ms <= 0 || cur.rx < prev.rx || cur.tx < prev.tx) return undefined
  return { down: ((cur.rx - prev.rx) * 1000) / ms, up: ((cur.tx - prev.tx) * 1000) / ms }
}

/** Counters from Linux /proc/net/dev, loopback left out. */
export function parseProcNetDev(text: string): NetCounters | null {
  let rx = 0
  let tx = 0
  let seen = false
  for (const l of text.split('\n')) {
    const m = /^\s*([^:\s]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/.exec(l)
    if (!m || m[1] === 'lo') continue
    rx += Number(m[2])
    tx += Number(m[3])
    seen = true
  }
  return seen ? { rx, tx } : null
}

/** 2 300 → "2 KB/s", 1 300 000 → "1,2 MB/s". */
export function fmtRate(bytesPerSec: number): string {
  const kb = bytesPerSec / 1024
  if (kb < 1000) return Math.round(kb) + ' KB/s'
  const mb = kb / 1024
  if (mb < 1000) return mb.toFixed(mb < 100 ? 1 : 0).replace('.', ',') + ' MB/s'
  return (mb / 1024).toFixed(1).replace('.', ',') + ' GB/s'
}

/** The newest run from GitHub's `GET /repos/{repo}/actions/runs` response, or null when there is none. */
export function parseCiRuns(json: unknown, repo: string): CiRun | null {
  const runs = obj(json)?.workflow_runs
  const r = Array.isArray(runs) ? obj(runs[0]) : null
  if (!r) return null
  const done = r.status === 'completed'
  const c = r.conclusion
  const state: CiState = !done
    ? r.status === 'in_progress'
      ? 'running'
      : 'queued'
    : c === 'success'
      ? 'success'
      : c === 'failure' || c === 'timed_out' || c === 'startup_failure'
        ? 'failure'
        : c === 'cancelled'
          ? 'cancelled'
          : 'other'
  const at = typeof r.updated_at === 'string' ? Date.parse(r.updated_at) : NaN
  const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 200) : '')
  return { repo, state, name: str(r.name), title: str(r.display_title), branch: str(r.head_branch), at: Number.isFinite(at) ? at : 0 }
}

export interface DeskStatus {
  serial: string
  port: number
  via: DeskVia
  /** Phones' browsers currently connected to the page. */
  viewers: number
}

/** One CPU reading: summed times of all cores. */
export interface CpuTimes {
  idle: number
  total: number
}

/** Busy share between two readings in percent, or undefined when no time passed. */
export function cpuPercent(prev: CpuTimes, cur: CpuTimes): number | undefined {
  const total = cur.total - prev.total
  if (total <= 0) return undefined
  const busy = total - (cur.idle - prev.idle)
  return Math.min(100, Math.max(0, (busy / total) * 100))
}

export interface UsageEvent {
  /** Message id + request id: the same reply is logged several times while it streams. */
  id: string
  session: string
  t: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/**
 * Token counts of one line of a Claude Code session log, or null when the line is not a model
 * reply. Only the counters are read; the text of the conversation is never kept.
 */
export function parseUsageLine(line: string): UsageEvent | null {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null
  let o: unknown
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  const r = o as { type?: unknown; timestamp?: unknown; requestId?: unknown; sessionId?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } }
  const u = r?.message?.usage
  if (r?.type !== 'assistant' || !u || typeof u !== 'object') return null
  const t = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN
  if (!Number.isFinite(t)) return null
  const mid = typeof r.message?.id === 'string' ? r.message.id : ''
  const rid = typeof r.requestId === 'string' ? r.requestId : ''
  if (!mid && !rid) return null
  return {
    id: `${mid}|${rid}`,
    session: typeof r.sessionId === 'string' ? r.sessionId : '',
    t,
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens)
  }
}

/**
 * Token counts of one line of an Antigravity (Gemini) conversation log
 * (~/.gemini/antigravity/brain/<conversation>/.system_generated/logs/transcript.jsonl), or null
 * when the line is not a model step. Its `input_tokens` do not include the cached part.
 */
export function parseAntigravityLine(line: string, conversation: string): UsageEvent | null {
  if (!line.includes('"input_tokens"')) return null
  let o: unknown
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  const r = o as { step_index?: unknown; created_at?: unknown; input_tokens?: unknown; output_tokens?: unknown; cache_read_tokens?: unknown }
  if (!r || typeof r !== 'object' || typeof r.input_tokens !== 'number' || typeof r.step_index !== 'number') return null
  const t = typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN
  if (!Number.isFinite(t)) return null
  return { id: `${conversation}|${r.step_index}`, session: conversation, t, input: num(r.input_tokens), output: num(r.output_tokens), cacheRead: num(r.cache_read_tokens), cacheWrite: 0 }
}

/** One AI tool found on this PC and what it used. */
export interface AiSourceUsage {
  id: string
  name: string
  usage: AiUsage
}

export const RECENT_MS =5 * 3600_000
export const ACTIVE_MS = 5 * 60_000

/** Totals for today (from `dayStart`) and the last five hours. */
export function sumUsage(events: Iterable<UsageEvent>, now: number, dayStart: number): AiUsage {
  const today = emptySum()
  const recent = emptySum()
  const active = new Set<string>()
  const add = (s: TokenSum, e: UsageEvent): void => {
    s.input += e.input
    s.output += e.output
    s.cacheRead += e.cacheRead
    s.cacheWrite += e.cacheWrite
    s.messages++
  }
  for (const e of events) {
    if (e.t > now + 60_000) continue
    if (e.t >= dayStart) add(today, e)
    if (e.t >= now - RECENT_MS) add(recent, e)
    if (e.t >= now - ACTIVE_MS) active.add(e.session)
  }
  return { today, recent, active: active.size }
}

/** 950 → "950", 12 400 → "12,4K", 3 250 000 → "3,25M". */
export function fmtTokens(n: number): string {
  const cut = (v: number, d: number): string => (d ? v.toFixed(d).replace(/\.?0+$/, '') : v.toFixed(0)).replace('.', ',')
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return `${cut(n / 1e3, n < 1e5 ? 1 : 0)}K`
  if (n < 1e9) return `${cut(n / 1e6, n < 1e8 ? 2 : 1)}M`
  return `${cut(n / 1e9, 2)}B`
}
