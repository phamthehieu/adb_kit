import type { ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { adb, adbBinary, adbSpawn, deviceDetails, q, shell } from './adb'
import { dumpUi } from './ui'
import { ScreenRecorder } from './recorder'
import { WebViewInspector } from './webview'
import { ChuckerWatcher } from './chucker'
import { OtpWatcher } from './otp'
import { agoText, appOps, getPermissions, revokeAllRuntime, setAppOp, type AppOp } from './permissions'
import { compareScreen, type VisualResult } from './visual'
import { PerfMonitor, frameStats, launchTimed, type FrameStats, type PerfSample, type StartupRecord } from './perf'

export interface PerfData {
  samples: PerfSample[]
  startups: StartupRecord[]
  frames: FrameStats | null
  /** Memory at the end of each round, and the leak verdict if it keeps climbing. */
  rounds?: { iteration: number; memMb: number }[]
  leak?: string
}

/** Where visual reference images live (set by main: Documents/ADB Kit/baselines). */
let baselinesRoot = ''
export function setBaselinesRoot(dir: string): void {
  baselinesRoot = dir
}

export type VisualRecord = VisualResult & { name: string; step: number; iteration: number; tolerance: number }
import type { ScrcpySession } from './scrcpy'
import { Action, keycode, scroll, text as textMsg, touch } from '../shared/control'
import {
  callFailed,
  describeStep,
  describeMock,
  PERF_LABEL,
  PERF_UNIT,
  findNode,
  shortPerm,
  type MockRule,
  type NetCall,
  type RunEvent,
  type RunOptions,
  type Script,
  type Selector,
  type Step,
  type UiNode,
  type WebError
} from '../shared/automation'
import { bugReport, writeReport, type ReportData, type StepResult } from './report'

/** App-ops every app touches constantly; not interesting in a "permissions used" list. */
const TRIVIAL_OPS = new Set(['WAKE_LOCK', 'TAKE_AUDIO_FOCUS', 'VIBRATE', 'START_FOREGROUND', 'READ_CLIPBOARD', 'TOAST_WINDOW', 'RUN_IN_BACKGROUND', 'RUN_ANY_IN_BACKGROUND', 'POST_NOTIFICATION', 'WRITE_CLIPBOARD'])

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

class Aborted extends Error {}
class StepFailed extends Error {}

/* ------------------------------------------------------------------ input */

interface Input {
  tap(x: number, y: number): Promise<void>
  longpress(x: number, y: number, ms: number): Promise<void>
  swipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void>
  scroll(x: number, y: number, dy: number): Promise<void>
  text(t: string): Promise<void>
  key(code: number): Promise<void>
}

/** Fast path: inject through the live scrcpy control socket. */
class ScrcpyInput implements Input {
  constructor(private readonly s: ScrcpySession) {}
  private px(x: number, y: number): [number, number, number, number] {
    return [x * this.s.width, y * this.s.height, this.s.width, this.s.height]
  }
  private send(a: Action, x: number, y: number): void {
    const [px, py, w, h] = this.px(x, y)
    this.s.sendControl(touch(a, px, py, w, h))
  }
  async tap(x: number, y: number): Promise<void> {
    this.send(Action.Down, x, y)
    await sleep(40)
    this.send(Action.Up, x, y)
  }
  async longpress(x: number, y: number, ms: number): Promise<void> {
    this.send(Action.Down, x, y)
    await sleep(ms)
    this.send(Action.Up, x, y)
  }
  async swipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void> {
    const steps = Math.max(2, Math.round(ms / 16))
    this.send(Action.Down, x1, y1)
    for (let i = 1; i <= steps; i++) {
      await sleep(ms / steps)
      const t = i / steps
      this.send(Action.Move, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
    }
    this.send(Action.Up, x2, y2)
  }
  async scroll(x: number, y: number, dy: number): Promise<void> {
    const [px, py, w, h] = this.px(x, y)
    this.s.sendControl(scroll(px, py, w, h, 0, dy))
  }
  async text(t: string): Promise<void> {
    this.s.sendControl(textMsg(t))
  }
  async key(code: number): Promise<void> {
    this.s.sendControl(keycode(Action.Down, code))
    this.s.sendControl(keycode(Action.Up, code))
  }
}

/** Fallback when the screen is not mirrored: `adb shell input` (slower, ~100-300 ms per call). */
class AdbInput implements Input {
  private size: [number, number] | null = null
  constructor(private readonly serial: string) {}
  private async px(x: number, y: number): Promise<[number, number]> {
    if (!this.size) {
      const r = await shell(this.serial, 'dumpsys window displays')
      const m = /cur=(\d+)x(\d+)/.exec(r.stdout)
      this.size = m ? [+m[1], +m[2]] : [1080, 1920]
    }
    return [Math.round(x * this.size[0]), Math.round(y * this.size[1])]
  }
  private async input(args: string): Promise<void> {
    await shell(this.serial, `input ${args}`)
  }
  async tap(x: number, y: number): Promise<void> {
    const [a, b] = await this.px(x, y)
    await this.input(`tap ${a} ${b}`)
  }
  async longpress(x: number, y: number, ms: number): Promise<void> {
    const [a, b] = await this.px(x, y)
    await this.input(`swipe ${a} ${b} ${a} ${b} ${ms}`)
  }
  async swipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void> {
    const [a, b] = await this.px(x1, y1)
    const [c, d] = await this.px(x2, y2)
    await this.input(`swipe ${a} ${b} ${c} ${d} ${ms}`)
  }
  async scroll(x: number, y: number, dy: number): Promise<void> {
    // Emulate a wheel notch with a short fling (dy > 0 = scroll up = finger moves down).
    const dist = Math.max(-0.4, Math.min(0.4, dy * 0.1))
    await this.swipe(x, y, x, Math.max(0.02, Math.min(0.98, y + dist)), 200)
  }
  async text(t: string): Promise<void> {
    // `input text` treats spaces specially and has no Unicode support.
    await this.input(`text ${q(t.replace(/ /g, '%s'))}`)
  }
  async key(code: number): Promise<void> {
    await this.input(`keyevent ${code}`)
  }
}

/* -------------------------------------------------------------- crash watch */

export interface Crash {
  type: 'crash' | 'anr' | 'native'
  pkg: string
  summary: string
  lines: string[]
}

/** Follows logcat during a run, keeps a ring buffer and reports app crashes / ANRs. */
export class CrashWatcher {
  private proc: ChildProcess | null = null
  readonly buffer: string[] = []
  private partial = ''
  private pendingFatal = -1

  constructor(
    serial: string,
    private readonly onCrash: (c: Crash) => void
  ) {
    // -T 1: only follow new lines (plus one), so old crashes are not reported again.
    this.proc = adbSpawn(['-s', serial, 'logcat', '-v', 'threadtime', '-T', '1'])
    this.proc.stdout?.setEncoding('utf8')
    this.proc.stdout?.on('data', (chunk: string) => {
      const lines = (this.partial + chunk).split(/\r?\n/)
      this.partial = lines.pop() ?? ''
      for (const l of lines) this.push(l)
    })
  }

  private push(line: string): void {
    this.buffer.push(line)
    if (this.buffer.length > 5000) this.buffer.splice(0, 1000)
    const i = this.buffer.length - 1
    if (line.includes('FATAL EXCEPTION')) {
      this.pendingFatal = i
      return
    }
    if (this.pendingFatal >= 0 && i - this.pendingFatal <= 4) {
      const m = /Process: ([\w.:]+), PID/.exec(line)
      if (m) {
        const at = this.pendingFatal
        this.pendingFatal = -1
        // Let the stack trace arrive before capturing it.
        setTimeout(() => {
          const lines = this.buffer.slice(at, at + 80).filter((l) => /AndroidRuntime/.test(l))
          const exc = lines.find((l) => /(Exception|Error)\b/.test(l) && !/FATAL EXCEPTION|Process:/.test(l))
          this.onCrash({ type: 'crash', pkg: m[1].split(':')[0], summary: clean(exc ?? lines[0] ?? line), lines })
        }, 800)
      }
      return
    }
    const anr = /ANR in ([\w.:]+)/.exec(line)
    if (anr) {
      setTimeout(() => {
        const lines = this.buffer.slice(i, i + 30)
        const reason = lines.find((l) => /Reason:/.test(l))
        this.onCrash({ type: 'anr', pkg: anr[1].split(':')[0], summary: clean(reason ?? line), lines })
      }, 800)
      return
    }
    const native = />>> ([\w.:]+) <<</.exec(line)
    if (native && /DEBUG/.test(line)) {
      setTimeout(() => {
        const lines = this.buffer.slice(Math.max(0, i - 3), i + 57).filter((l) => /DEBUG|libc/.test(l))
        const sig = lines.find((l) => /signal \d+/.test(l))
        this.onCrash({ type: 'native', pkg: native[1].split(':')[0], summary: clean(sig ?? line), lines })
      }, 800)
    }
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
  }
}

/**
 * Memory leak heuristic over rounds of the same script: the app should come back to roughly the
 * same memory after each round. Flag when it keeps climbing — at least 4 rounds, ≥ 75% of round
 * steps going up, and a total growth over 20% and 25 MB from the second round (the first one
 * warms caches up).
 */
export function leakVerdict(rounds: { iteration: number; memMb: number }[]): string | undefined {
  if (rounds.length < 4) return undefined
  const r = rounds.slice(1)
  const ups = r.slice(1).filter((x, i) => x.memMb > r[i].memMb).length
  const first = r[0].memMb
  const last = r[r.length - 1].memMb
  const grow = last - first
  if (ups / (r.length - 1) >= 0.75 && grow > 25 && grow / first > 0.2) {
    return `Có dấu hiệu rò rỉ bộ nhớ: RAM tăng từ ${first} MB lên ${last} MB qua ${r.length} lượt (+${Math.round(grow)} MB, ~${Math.round(grow / (r.length - 1))} MB/lượt) và không giảm lại`
  }
  return undefined
}

/** Strip the logcat "date time pid tid L Tag:" prefix. */
function clean(l: string): string {
  return l.replace(/^\d\d-\d\d \S+\s+\d+\s+\d+ \w (\S+)\s*:\s?/, '').trim()
}

/** Steps that may change what is on screen (they invalidate the cached UI dump). */
const ACTIONS = new Set<Step['type']>([
  'tap', 'tapIf', 'longpress', 'swipe', 'scroll', 'text', 'key', 'wait', 'launch', 'stopApp', 'network', 'permission', 'deeplink', 'shell',
  'permRevokeAll', 'appop', 'mock', 'mockClear', 'reloadWebView', 'otp', 'mockFile'
])
// Note: 'perf' is a check, not an action — it must not move the "since last action" window.

/* ------------------------------------------------------------------ runner */

export class Runner {
  private aborted = false
  private crash: Crash | null = null
  private wake: (() => void) | null = null
  private dump: { nodes: UiNode[]; gen: number } | null = null
  private gen = 0
  private current = { step: 0, iteration: 0 }
  private webErrors: WebError[] = []
  private calls = new Map<string, NetCall>()
  private web: WebViewInspector | null = null
  /** Native app with Chucker: API calls come from its database. */
  private chucker: ChuckerWatcher | null = null
  /** App memory at the end of each round (repeat > 1, performance on). */
  private roundMem: { iteration: number; memMb: number }[] = []
  /** One-time codes from notifications (created at run start when the script has an OTP step). */
  private otp: OtpWatcher | null = null
  /** When each step started (host ms) — Chucker calls arrive late, so they are matched by time. */
  private stepTimes: { t: number; step: number; iteration: number }[] = []
  /** When the most recent action step started: "api" checks only look at calls after it. */
  private actionStartedAt = 0
  private model = ''
  private appVersion = ''
  private mockRules: MockRule[] = []
  private mocksUsed: string[] = []
  private visuals: VisualRecord[] = []
  private perf: PerfMonitor | null = null
  private startups: StartupRecord[] = []
  private runStart = Date.now()
  readonly dir: string
  /** Set when run() finishes. */
  outcome: { result: 'passed' | 'failed' | 'stopped' | 'crashed'; message: string; report: string } | null = null

  constructor(
    private readonly serial: string,
    private readonly script: Script,
    private readonly opts: RunOptions,
    private readonly getSession: () => ScrcpySession | null,
    private readonly emit: (e: RunEvent) => void,
    reportsRoot: string,
    dirName?: string
  ) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safe = script.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'test'
    this.dir = join(reportsRoot, dirName ?? `${stamp}_${safe}`)
  }

  stop(): void {
    this.aborted = true
    this.wake?.()
  }

  /** Sleep that ends early on stop() or crash. */
  private async wait(ms: number): Promise<void> {
    if (ms <= 0) return
    await new Promise<void>((r) => {
      const t = setTimeout(r, ms)
      this.wake = () => {
        clearTimeout(t)
        r()
      }
    })
    this.wake = null
    this.check()
  }

  private check(): void {
    if (this.aborted) throw new Aborted()
  }

  private input(): Input {
    const s = this.getSession()
    return s && s.serial === this.serial && s.isOpen ? new ScrcpyInput(s) : new AdbInput(this.serial)
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit({ kind: 'log', level, message })
  }

  async run(): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    const started = new Date()
    const results: StepResult[] = []
    const shots: { label: string; file: string }[] = []
    const { steps } = this.script
    const repeat = Math.max(1, this.opts.repeat)

    if (steps.some((s) => s.type === 'otp')) this.otp = new OtpWatcher(this.serial)
    const watcher = new CrashWatcher(this.serial, (c) => {
      const ours = !this.script.app || c.pkg === this.script.app
      this.emit({ kind: 'crash', type: c.type, pkg: c.pkg, summary: c.summary })
      this.log(ours ? 'error' : 'warn', `${c.type.toUpperCase()} trong ${c.pkg}: ${c.summary}`)
      if (ours && !this.crash) {
        this.crash = c
        if (this.opts.stopOnCrash) this.stop()
      }
    })

    // Screen recording and WebView error capture run alongside the steps.
    const recorder = this.opts.recordVideo ? new ScreenRecorder(this.serial, this.dir) : null
    recorder?.start()
    let web: WebViewInspector | null = null
    const needApi = this.opts.captureApi !== false || steps.some((s) => s.type === 'api' || s.type === 'mock' || s.type === 'reloadWebView')
    if ((this.opts.webErrors || needApi) && this.script.app) {
      const devNow = Number((await shell(this.serial, 'date +%s')).stdout.trim()) * 1000 || Date.now()
      web = new WebViewInspector(
        this.serial,
        this.script.app,
        devNow - 1000,
        {
          onError: (e) => {
            const err: WebError = { ...e, step: this.current.step, iteration: this.current.iteration }
            this.webErrors.push(err)
            if (this.webErrors.length <= 200) this.emit({ kind: 'webError', error: err })
          },
          onCall: (c) => {
            const prev = this.calls.get(c.id)
            // Keep the step that was running when the call STARTED.
            this.calls.set(c.id, prev ? { ...c, step: prev.step, iteration: prev.iteration } : { ...c, step: this.current.step, iteration: this.current.iteration })
          },
          onInfo: (msg) => this.log('info', msg)
        },
        { errors: this.opts.webErrors, network: needApi, bridge: needApi }
      )
      web.start()
      this.web = web
    }
    if (needApi && this.script.app) {
      const chk = new ChuckerWatcher(
        this.serial,
        this.script.app,
        {
          onCall: (c) => {
            const at = [...this.stepTimes].reverse().find((s) => s.t <= c.startedAt + 50)
            this.calls.set(c.id, { ...c, step: at?.step ?? 0, iteration: at?.iteration ?? 1 })
          },
          onInfo: (msg) => this.log('info', msg)
        },
        Date.now() - 1000
      )
      if (await chk.start().catch(() => false)) this.chucker = chk
      else await chk.stop()
    }
    const appOpsBefore = this.script.app ? await appOps(this.serial, this.script.app).catch(() => ({})) : {}
    if (this.opts.measurePerf !== false && this.script.app) {
      this.runStart = Date.now()
      this.perf = new PerfMonitor(this.serial, this.script.app, () => this.current.step)
      await this.perf.start()
    }
    // For visual baselines (per device model) and the bug report header.
    this.model = (await shell(this.serial, 'getprop ro.product.model')).stdout.trim() || this.serial
    if (this.script.app) {
      const v = await shell(this.serial, `dumpsys package ${q(this.script.app)} | grep -m1 versionName`)
      this.appVersion = /versionName=(\S+)/.exec(v.stdout)?.[1] ?? ''
    }

    this.emit({ kind: 'start', total: steps.length, repeat })
    let result: 'passed' | 'failed' | 'stopped' | 'crashed' = 'passed'
    let message = ''
    let failShot: string | undefined

    try {
      await sleep(300) // let logcat attach before acting
      for (let it = 0; it < repeat; it++) {
        if (repeat > 1) this.log('info', `Lượt ${it + 1}/${repeat}`)
        for (let i = 0; i < steps.length; i++) {
          this.check()
          const step = steps[i]
          this.current = { step: i + 1, iteration: it + 1 }
          this.stepTimes.push({ t: Date.now(), ...this.current })
          const t0 = Date.now()
          this.emit({ kind: 'step', iteration: it, index: i, state: 'running' })
          try {
            const note = await this.exec(step, shots, it, i)
            const state = note ? 'warn' : 'ok'
            results.push({ iteration: it, index: i, text: describeStep(step), state, ms: Date.now() - t0, message: note })
            this.emit({ kind: 'step', iteration: it, index: i, state, message: note })
          } catch (e) {
            if (e instanceof Aborted) {
              // Keep the interrupted step so "steps to reproduce" ends where it happened.
              const msg = this.crash ? `${this.crash.type.toUpperCase()} xảy ra trong bước này` : 'đã dừng'
              results.push({ iteration: it, index: i, text: describeStep(step), state: 'failed', ms: Date.now() - t0, message: msg })
              this.emit({ kind: 'step', iteration: it, index: i, state: 'failed', message: msg })
              throw e
            }
            const msg = (e as Error).message
            results.push({ iteration: it, index: i, text: describeStep(step), state: 'failed', ms: Date.now() - t0, message: msg })
            this.emit({ kind: 'step', iteration: it, index: i, state: 'failed', message: msg })
            this.log('error', `Bước ${i + 1} lỗi: ${msg}`)
            if (!(e instanceof StepFailed) || this.opts.stopOnFailure) {
              result = 'failed'
              message = `Bước ${i + 1} (${describeStep(step)}) lỗi: ${msg}`
              failShot = await this.capture('luc-loi', shots)
              throw new Aborted()
            }
            if (result === 'passed') {
              result = 'failed'
              message = `Bước ${i + 1} lỗi: ${msg}`
            }
          }
          // Crashes are detected asynchronously; check after each step.
          if (this.crash) throw new Aborted()
        }
        // Memory at the end of every round: a steady climb over rounds suggests a leak.
        if (this.perf && repeat > 1) {
          const s = await this.perf.sample()
          if (s?.memMb !== undefined) this.roundMem.push({ iteration: it + 1, memMb: s.memMb })
        }
      }
    } catch (e) {
      if (!(e instanceof Aborted)) {
        result = 'failed'
        message = (e as Error).message
      } else if (this.crash) {
        result = 'crashed'
        message = `${this.crash.type.toUpperCase()} trong ${this.crash.pkg}: ${this.crash.summary}`
        failShot = await this.capture('luc-crash', shots)
      } else if (result === 'passed') {
        result = 'stopped'
        message = 'Người dùng đã dừng'
      }
    }

    // Give logcat / DevTools a moment to deliver what happened right at the end.
    await sleep(800)
    watcher.stop()
    await web?.stop()
    this.web = null
    await this.chucker?.flush()
    await this.chucker?.stop()
    this.chucker = null
    this.perf?.stop()
    const frames = this.perf && this.script.app ? await frameStats(this.serial, this.script.app).catch(() => null) : null
    this.log('info', recorder ? 'Đang lưu video…' : 'Đang tạo báo cáo…')
    const videos = (await recorder?.stop().catch(() => [])) ?? []

    // Which permissions / protected operations did the app use while the test ran?
    const permsUsed: { op: string; mode: string; ago: string }[] = []
    if (this.script.app) {
      const after = await appOps(this.serial, this.script.app).catch(() => ({}) as Record<string, AppOp>)
      const runMs = Date.now() - started.getTime()
      for (const [op, a] of Object.entries(after)) {
        const before = (appOpsBefore as Record<string, AppOp>)[op]
        const changed = a.agoMs !== undefined && (before?.agoMs === undefined || a.agoMs < before.agoMs)
        if (changed && a.agoMs! <= runMs && !TRIVIAL_OPS.has(op)) permsUsed.push({ op, mode: a.mode, ago: agoText(a.agoMs!) })
      }
    }

    const jsErrors = this.webErrors.filter((e) => e.kind === 'exception' || e.kind === 'console').length
    if (result === 'passed') {
      message = `Đạt cả ${steps.length} bước${repeat > 1 ? ` × ${repeat} lượt` : ''}`
      if (this.webErrors.length) message += ` — ghi nhận ${this.webErrors.length} lỗi WebView`
      if (this.opts.failOnWebErrors && jsErrors) {
        result = 'failed'
        message = `Các bước đều đạt nhưng có ${jsErrors} lỗi JavaScript`
      }
    }

    const report: ReportData = {
      script: this.script,
      options: this.opts,
      serial: this.serial,
      device: await deviceDetails(this.serial).catch(() => null),
      started,
      finished: new Date(),
      result,
      message,
      results,
      crash: this.crash ? { type: this.crash.type, pkg: this.crash.pkg, summary: this.crash.summary, lines: this.crash.lines } : null,
      logcat: watcher.buffer,
      screenshots: shots,
      failShot,
      videos,
      webErrors: this.webErrors,
      calls: [...this.calls.values()].sort((a, b) => a.startedAt - b.startedAt),
      permsUsed,
      visuals: this.visuals,
      appVersion: this.appVersion,
      mocksUsed: this.mocksUsed,
      perf: this.perf
        ? { samples: this.perf.samples, startups: this.startups, frames, rounds: this.roundMem, leak: leakVerdict(this.roundMem) }
        : this.startups.length
          ? { samples: [], startups: this.startups, frames: null }
          : null
    }
    if (report.perf?.leak) this.log('warn', report.perf.leak)
    const path = writeReport(this.dir, report)
    writeFileSync(join(this.dir, 'script.json'), JSON.stringify(this.script, null, 2))
    // Machine-readable copy (without the big logcat) — used to compare two runs / builds.
    writeFileSync(join(this.dir, 'report.json'), JSON.stringify({ ...report, logcat: [] }))
    this.outcome = { result, message, report: path }
    const bug = result === 'passed' || result === 'stopped' ? undefined : bugReport(report, path)
    if (bug) writeFileSync(join(this.dir, 'bao-loi.md'), bug)
    this.emit({ kind: 'report', path, title: `${this.script.name} — ${result}`, bug })
    this.emit({ kind: 'end', result, message })
  }

  private async capture(label: string, shots: { label: string; file: string }[]): Promise<string | undefined> {
    try {
      const png = await adbBinary(['-s', this.serial, 'exec-out', 'screencap', '-p'])
      const file = `${String(shots.length + 1).padStart(2, '0')}_${label.replace(/[^\w-]+/g, '_')}.png`
      writeFileSync(join(this.dir, file), png)
      shots.push({ label, file })
      return file
    } catch {
      return undefined
    }
  }

  /**
   * Locate an element, retrying until the timeout. Consecutive checks with no action in
   * between reuse the same UI dump (a dump costs ~2 s), so a row of asserts is fast.
   */
  private async find(target: Selector, timeoutMs: number, near?: { x: number; y: number }): Promise<UiNode | null> {
    const deadline = Date.now() + timeoutMs
    let fresh = false
    for (;;) {
      this.check()
      if (!this.dump || this.dump.gen !== this.gen || fresh) {
        try {
          this.dump = { nodes: (await dumpUi(this.serial)).nodes, gen: this.gen }
        } catch (e) {
          this.dump = null
          this.log('warn', `Không đọc được màn hình: ${(e as Error).message}`)
        }
      }
      const n = this.dump ? findNode(this.dump.nodes, target, near) : null
      if (n) return n
      if (Date.now() >= deadline) return null
      fresh = true // retries must look at the screen again
      await this.wait(300)
    }
  }

  /**
   * "Kiểm tra API": among calls made since the last action, find one matching the step
   * (URL / command contains `match`, kind, method) and check its status and body.
   */
  private async checkApi(s: Extract<Step, { type: 'api' }>): Promise<string | undefined> {
    if (!this.web && !this.chucker)
      throw new StepFailed('chưa theo dõi API — cần chọn "App cần test" và app phải là bản build debug (có WebView hoặc Chucker)')
    const since = this.actionStartedAt - 100
    const want = s.match.trim().toLowerCase()
    const isMatch = (c: NetCall): boolean =>
      c.startedAt >= since &&
      (!s.kind || s.kind === 'any' || c.kind === s.kind) &&
      (!s.method || c.method.toUpperCase() === s.method.toUpperCase()) &&
      c.url.toLowerCase().includes(want)
    const passes = (c: NetCall): string | null => {
      if (c.status === undefined) return 'chưa có phản hồi'
      if (s.status ? c.status !== s.status : callFailed(c)) return `trả về ${c.status || c.error || 'lỗi'}`
      if (s.bodyContains && !(c.result ?? '').includes(s.bodyContains)) return `kết quả không chứa "${s.bodyContains}"`
      return null
    }
    const deadline = Date.now() + s.timeoutMs
    let lastReason = ''
    let flushed = false
    for (;;) {
      // Chucker is polled every second; read it once more right before deciding.
      if (this.chucker && Date.now() >= deadline && !flushed) {
        await this.chucker.flush()
        flushed = true
      }
      const hits = [...this.calls.values()].filter(isMatch)
      if (s.absent) {
        if (hits.length) throw new StepFailed(`có gọi ${hits[0].method} ${hits[0].url}`)
      } else {
        for (const c of hits) {
          const why = passes(c)
          if (!why) {
            this.log('info', `API ✓ ${c.method} ${c.url} → ${c.status} (${c.durationMs ?? '?'} ms)`)
            return
          }
          lastReason = `${c.method} ${c.url.slice(0, 120)} ${why}`
        }
      }
      if (Date.now() >= deadline && (flushed || !this.chucker)) break
      await this.wait(200)
    }
    if (s.absent) return
    if (!this.chucker && this.web && !this.web.connected) throw new StepFailed('không kết nối được DevTools của WebView')
    throw new StepFailed(lastReason || `không thấy API/lệnh nào chứa "${s.match}" sau ${Math.round(s.timeoutMs / 1000)} giây`)
  }

  /** Runs one step. Returns a warning message, or undefined when all went as planned. */
  private async exec(step: Step, shots: { label: string; file: string }[], it: number, i: number): Promise<string | undefined> {
    // "api" checks look at calls made since the last real action (waits don't count).
    if (ACTIONS.has(step.type) && step.type !== 'wait' && step.type !== 'shell') this.actionStartedAt = Date.now()
    try {
      return await this.execInner(step, shots, it, i)
    } finally {
      if (ACTIONS.has(step.type)) this.gen++
    }
  }

  private async execInner(step: Step, shots: { label: string; file: string }[], it: number, i: number): Promise<string | undefined> {
    const input = this.input()
    const speed = this.opts.speed > 0 ? this.opts.speed : 1
    const center = (n: UiNode): [number, number] => [(n.b[0] + n.b[2]) / 2, (n.b[1] + n.b[3]) / 2]

    switch (step.type) {
      case 'tap':
      case 'longpress': {
        let { x, y } = step
        let note: string | undefined
        if (this.opts.smartTargets && step.target) {
          const n = await this.find(step.target, 5000, { x, y })
          if (n) [x, y] = center(n)
          else note = 'không tìm thấy phần tử — đã bấm theo vị trí đã ghi'
        }
        if (step.type === 'tap') await input.tap(x, y)
        else await input.longpress(x, y, step.ms)
        await this.wait(150)
        return note
      }
      case 'tapIf': {
        const n = await this.find(step.target, step.timeoutMs)
        if (!n) return 'không thấy — bỏ qua'
        const [x, y] = center(n)
        await input.tap(x, y)
        await this.wait(300)
        return
      }
      case 'swipe':
        await input.swipe(step.x1, step.y1, step.x2, step.y2, step.ms)
        await this.wait(150)
        return
      case 'scroll':
        await input.scroll(step.x, step.y, step.dy)
        await this.wait(100)
        return
      case 'text':
        await input.text(step.text)
        return
      case 'key':
        await input.key(step.code)
        await this.wait(150)
        return
      case 'wait':
        await this.wait(step.ms * speed)
        return
      case 'waitFor': {
        const n = await this.find(step.target, step.timeoutMs)
        if (!n) throw new StepFailed(`không xuất hiện sau ${Math.round(step.timeoutMs / 1000)} giây`)
        return
      }
      case 'assert': {
        // A short grace period absorbs animations before deciding.
        const n = await this.find(step.target, step.visible ? 2000 : 0)
        if (step.visible && !n) throw new StepFailed('không thấy trên màn hình')
        if (!step.visible && n) throw new StepFailed('vẫn đang hiển thị trong khi lẽ ra không')
        return
      }
      case 'launch': {
        if (step.clear) {
          const r = await shell(this.serial, `pm clear ${q(step.pkg)}`)
          if (!/Success/.test(r.stdout)) throw new StepFailed(`xóa dữ liệu thất bại: ${(r.stdout + r.stderr).trim()}`)
        }
        // `am start -W` also tells how long the launch took (TotalTime).
        const timed = await launchTimed(this.serial, step.pkg).catch(() => null)
        if (timed) {
          this.startups.push({ step: i + 1, ms: timed.ms, cold: timed.cold })
          this.log('info', `Mở app mất ${timed.ms} ms (${timed.cold ? 'khởi động nguội' : 'app đang chạy sẵn'})`)
        } else {
          const r = await shell(this.serial, `monkey -p ${q(step.pkg)} -c android.intent.category.LAUNCHER 1`)
          if (/No activities found|Error/.test(r.stdout + r.stderr)) throw new StepFailed(`không mở được ${step.pkg}`)
        }
        await this.wait(1500 * speed)
        return
      }
      case 'perf': {
        const unit = PERF_UNIT[step.metric]
        let value: number | undefined
        if (step.metric === 'startup') value = this.startups[this.startups.length - 1]?.ms
        else if (step.metric === 'memory') value = (await this.perf?.sample())?.memMb ?? [...(this.perf?.samples ?? [])].reverse().find((s) => s.memMb !== undefined)?.memMb
        else if (step.metric === 'cpu') {
          await this.perf?.sample()
          const since = this.actionStartedAt - (this.perf ? this.runStart : 0)
          const vals = (this.perf?.samples ?? []).filter((s) => s.cpu !== undefined && s.t >= since).map((s) => s.cpu!)
          value = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : undefined
        } else if (this.script.app) value = (await frameStats(this.serial, this.script.app))?.jankPct
        if (value === undefined) {
          throw new StepFailed(
            step.metric === 'startup' ? 'chưa có lần mở app nào được đo (cần bước "Mở app" trước)' : 'chưa đo được — cần chọn "App cần test", app đang chạy và bật "Đo hiệu năng"'
          )
        }
        if (value > step.max) throw new StepFailed(`${PERF_LABEL[step.metric]} = ${value} ${unit} (cho phép ≤ ${step.max} ${unit})`)
        this.log('info', `${PERF_LABEL[step.metric]} = ${value} ${unit} ✓`)
        return
      }
      case 'stopApp':
        await adb(['-s', this.serial, 'shell', 'am', 'force-stop', step.pkg])
        await this.wait(300)
        return
      case 'screenshot': {
        const f = await this.capture(step.label || `luot${it + 1}_buoc${i + 1}`, shots)
        return f ? undefined : 'chụp màn hình thất bại'
      }
      case 'network': {
        // Turning Wi-Fi off would cut an adb-over-Wi-Fi connection mid-test.
        if (step.wifi === 'off' && /:\d+$|_adb-tls-connect/.test(this.serial))
          throw new StepFailed('đang kết nối adb qua Wi-Fi — không thể tắt Wi-Fi (hãy cắm cáp USB)')
        if (step.wifi) await shell(this.serial, `svc wifi ${step.wifi === 'on' ? 'enable' : 'disable'}`)
        if (step.data) await shell(this.serial, `svc data ${step.data === 'on' ? 'enable' : 'disable'}`)
        await this.wait(1500) // let connectivity settle
        return
      }
      case 'permission': {
        const r = await shell(this.serial, `pm ${step.grant ? 'grant' : 'revoke'} ${q(step.pkg)} ${q(step.permission)}`)
        const out = (r.stdout + r.stderr).trim()
        if (r.code !== 0 || /Exception|not a changeable|Unknown permission/i.test(out)) throw new StepFailed(out || 'pm grant thất bại')
        return
      }
      case 'otp': {
        // Watching starts with the run, so a code sent by an earlier step is not missed,
        // and codes that were already on the phone before the run are never used.
        this.otp ??= new OtpWatcher(this.serial)
        const hit = await this.otp.next(step.timeoutMs).catch((e: Error) => {
          throw new StepFailed(e.message)
        })
        this.log('info', `Mã OTP ${hit.code} từ ${hit.title || hit.pkg}`)
        await input.text(hit.code)
        return
      }
      case 'deeplink': {
        const r = await shell(this.serial, `am start -W -a android.intent.action.VIEW -d ${q(step.url)}`)
        if (/Error|unable to resolve/i.test(r.stdout + r.stderr)) throw new StepFailed(`không mở được link: ${(r.stdout + r.stderr).trim().split('\n').pop()}`)
        await this.wait(1000 * speed)
        return
      }
      case 'shell': {
        const r = await shell(this.serial, step.cmd, 60_000)
        const out = (r.stdout + r.stderr).trim()
        if (step.expect && !out.includes(step.expect))
          throw new StepFailed(`kết quả không chứa "${step.expect}": ${out.slice(0, 300) || '(trống)'}`)
        if (out) this.log('info', `shell → ${out.split('\n').slice(0, 3).join(' | ').slice(0, 200)}`)
        return
      }
      case 'api':
        return this.checkApi(step)
      case 'permCheck': {
        const p = (await getPermissions(this.serial, step.pkg)).find((x) => x.name === step.permission)
        if (!p) throw new StepFailed(`app không khai báo quyền ${shortPerm(step.permission)}`)
        const granted = p.granted === true
        if (granted !== (step.expect === 'granted'))
          throw new StepFailed(`quyền ${shortPerm(step.permission)} đang ${granted ? 'được cấp' : p.granted === null ? 'ở mặc định' : 'bị từ chối'}`)
        return
      }
      case 'permRevokeAll': {
        const r = await revokeAllRuntime(this.serial, step.pkg)
        if (!r.ok) throw new StepFailed(r.output)
        this.log('info', r.output.replace(/\n/g, ' · '))
        await this.wait(500) // Android kills the app on revoke
        return
      }
      case 'visual': {
        await this.wait(500) // let animations settle
        const png = await adbBinary(['-s', this.serial, 'exec-out', 'screencap', '-p'])
        const safe = (s: string): string => s.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'x'
        const baseline = join(baselinesRoot, safe(this.script.name), safe(this.model), `${safe(step.name)}.png`)
        const label = `${String(i + 1).padStart(2, '0')}_${step.name}${it ? `_luot${it + 1}` : ''}`
        const r = compareScreen(png, baseline, this.dir, label, {
          tolerance: step.tolerance,
          ignoreBars: step.ignoreBars,
          masks: step.masks,
          update: !!this.opts.updateBaselines
        })
        this.visuals.push({ ...r, name: step.name, step: i + 1, iteration: it + 1, tolerance: step.tolerance })
        if (r.created) return this.opts.updateBaselines ? 'đã cập nhật ảnh chuẩn' : 'chưa có ảnh chuẩn — đã lưu màn hình này làm ảnh chuẩn'
        if (r.sizeMismatch) throw new StepFailed(r.sizeMismatch)
        if (r.diffPercent > step.tolerance) throw new StepFailed(`khác ảnh chuẩn ${r.diffPercent}% (cho phép ${step.tolerance}%) — xem ảnh khác biệt trong báo cáo`)
        this.log('info', `Màn hình "${step.name}" khớp ảnh chuẩn (lệch ${r.diffPercent}%)`)
        return
      }
      case 'mock': {
        if (!this.web) throw new StepFailed('giả lập API cần chọn "App cần test" (bản build debug có WebView)')
        this.mockRules = [...this.mockRules, step.rule]
        await this.web.setMocks(this.mockRules)
        this.mocksUsed.push(describeMock(step.rule))
        return
      }
      case 'mockFile': {
        // A recorded set of API answers (saved from the Mạng / API tab): replay all of them.
        if (!this.web) throw new StepFailed('phát lại API cần chọn "App cần test" (bản build debug có WebView)')
        let rules: MockRule[]
        try {
          rules = JSON.parse(readFileSync(step.path, 'utf8')) as MockRule[]
        } catch (e) {
          throw new StepFailed(`không đọc được file dữ liệu giả: ${(e as Error).message}`)
        }
        this.mockRules = [...this.mockRules, ...rules]
        await this.web.setMocks(this.mockRules)
        this.mocksUsed.push(`phát lại ${rules.length} API từ ${basename(step.path)}`)
        return
      }
      case 'mockClear':
        this.mockRules = []
        await this.web?.setMocks([])
        return
      case 'reloadWebView': {
        // The inspector may still be attaching right after an app launch.
        for (let t = 0; t < 30 && this.web && !this.web.connected; t++) await this.wait(200)
        if (!this.web || !(await this.web.reload())) throw new StepFailed('chưa kết nối được WebView của app (cần bản build debug)')
        await this.wait(1500 * speed)
        return
      }
      case 'appop': {
        const r = await setAppOp(this.serial, step.pkg, step.op, step.mode)
        if (!r.ok) throw new StepFailed(r.output || 'cmd appops thất bại')
        return
      }
    }
  }
}
