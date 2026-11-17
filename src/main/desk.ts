// "Bảng theo dõi": a phone that is plugged in but not being tested shows live information about
// this PC (clock, CPU, RAM, Claude Code tokens). Display only: the page cannot ask the PC to do
// anything. It is served on 127.0.0.1 and reaches the phone through `adb reverse`; no setting of
// the phone is changed. The page is shown by ADB Kit's small viewer app (installed over adb the
// first time) or, if the user prefers to install nothing, by the phone's browser.
import { randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { cpus, freemem, hostname, totalmem } from 'node:os'
import { adb, q, shell } from './adb'
import { AiSources } from './aiUsage'
import { CiWatcher } from './deskCi'
import { sendMediaKey, SysWatcher, type MediaAction } from './deskSys'
import { deskPageHtml } from './deskPage'
import { existsSync } from 'node:fs'
import { DESK_APP, cpuPercent, installedVersion, normalizeDesk, screenCenter, type AiSourceUsage, type CpuTimes, type DeskConfig, type DeskSnapshot, type DeskStatus, type DeskVia } from '../shared/desk'

const AI_EVERY_MS = 5000

function cpuTimes(): CpuTimes {
  let idle = 0
  let total = 0
  for (const c of cpus()) {
    idle += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle
  }
  return { idle, total }
}

/** Serves the page and a stream of snapshots to whoever knows the key. */
export class DeskServer {
  readonly key = randomBytes(12).toString('hex')
  private server: Server | null = null
  private clients = new Set<ServerResponse>()
  private last = ''

  constructor(private readonly onMedia?: (action: MediaAction) => void) {}

  get viewers(): number {
    return this.clients.size
  }

  start(): Promise<number> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method !== 'GET' || url.searchParams.get('k') !== this.key) {
        res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
        return
      }
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(deskPageHtml())
        return
      }
      if (url.pathname === '/media') {
        const act = url.searchParams.get('action')
        if (act === 'prev' || act === 'toggle' || act === 'next') {
          this.onMedia?.(act)
          res.writeHead(204, { 'cache-control': 'no-store' }).end()
        } else {
          res.writeHead(400).end('bad action')
        }
        return
      }
      if (url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write('retry: 2000\n\n')
        if (this.last) res.write(`data: ${this.last}\n\n`)
        this.clients.add(res)
        res.on('close', () => this.clients.delete(res))
        return
      }
      res.writeHead(404).end()
    })
    this.server = server
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const a = server.address()
        resolve(typeof a === 'object' && a ? a.port : 0)
      })
    })
  }

  send(snapshot: DeskSnapshot, config: DeskConfig): void {
    this.last = JSON.stringify({ s: snapshot, c: config })
    for (const c of this.clients) c.write(`data: ${this.last}\n\n`)
  }

  stop(): Promise<void> {
    for (const c of this.clients) c.destroy()
    this.clients.clear()
    const s = this.server
    this.server = null
    return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()))
  }
}

interface Active {
  serial: string
  port: number
  server: DeskServer
  /** How the page was opened; fixed for the life of this session. */
  via: DeskVia
  config: DeskConfig
  timer: NodeJS.Timeout
  lost: boolean
  snap: DeskSnapshot | null
  sys: SysWatcher
  ci: CiWatcher
}

let helperPath = ''
/** Where the Windows helper script is (set by main at startup). */
export function setDeskHelper(path: string): void {
  helperPath = path
}

let active: Active | null = null

let apkPath = ''
/** Where the bundled viewer app is (set by main at startup). */
export function setDeskApk(path: string): void {
  apkPath = path
}

export const deskStatus = (): DeskStatus | null => (active ? { serial: active.serial, port: active.port, via: active.via, viewers: active.server.viewers } : null)

const said = (r: { stdout: string; stderr: string }): string => (r.stderr || r.stdout).trim()

/** Install the viewer app when the phone does not have it or has an older one. */
async function ensureApp(serial: string): Promise<void> {
  const have = installedVersion((await shell(serial, `dumpsys package ${DESK_APP.pkg}`, 10_000)).stdout)
  if (have !== null && have >= DESK_APP.versionCode) return
  if (!apkPath || !existsSync(apkPath)) throw new Error('bản ADB Kit này không kèm app hiển thị (adbkit-desk.apk); hãy chọn "Trình duyệt"')
  let r = await adb(['-s', serial, 'install', '-r', apkPath], 90_000)
  // Built on another PC = signed with another key: Android refuses to update, so replace it.
  if (/INSTALL_FAILED_(UPDATE_INCOMPATIBLE|VERSION_DOWNGRADE)/.test(r.stdout + r.stderr)) {
    await adb(['-s', serial, 'uninstall', DESK_APP.pkg], 30_000)
    r = await adb(['-s', serial, 'install', '-r', apkPath], 90_000)
  }
  if (!/Success/.test(r.stdout)) throw new Error(`không cài được app hiển thị lên điện thoại: ${said(r)}. Một số máy cần bật "Cài đặt qua USB" trong Tùy chọn nhà phát triển; hoặc chọn "Trình duyệt".`)
}

/** Remove the viewer app from the phone. */
export async function uninstallDeskApp(serial: string): Promise<string> {
  if (active?.serial === serial && active.via === 'app') await stopDesk()
  const r = await adb(['-s', serial, 'uninstall', DESK_APP.pkg], 30_000)
  return /Success/.test(r.stdout) ? 'Đã gỡ app hiển thị khỏi điện thoại.' : 'Điện thoại không có app hiển thị để gỡ.'
}
export const deskSnapshot = (): DeskSnapshot | null => active?.snap ?? null

function sample(a: Active, reader: AiSources, state: { prev: CpuTimes; ai?: AiSourceUsage[]; aiAt: number }): void {
  const now = Date.now()
  const cur = cpuTimes()
  const cpu = cpuPercent(state.prev, cur)
  state.prev = cur
  if (a.config.widgets.ai && now - state.aiAt >= AI_EVERY_MS) {
    state.aiAt = now
    void reader.read(now).then((u) => (state.ai = u)).catch(() => {})
  }
  const total = totalmem()
  const w = a.config.widgets
  const sys = a.sys.latest(now)
  a.ci.watch(w.ci ? a.config.ciRepo : '')
  a.snap = {
    t: now,
    host: hostname(),
    cpu,
    cores: cpus().length,
    memUsed: total - freemem(),
    memTotal: total,
    ai: w.ai ? state.ai : undefined,
    gpu: w.gpu ? sys.gpu : undefined,
    net: w.net ? sys.net : undefined,
    battery: w.battery ? sys.battery : undefined,
    media: w.media ? sys.media : undefined,
    ci: w.ci ? a.ci.latest() : undefined
  }
  a.server.send(a.snap, a.config)
}

export async function startDesk(serial: string, config: Partial<DeskConfig>): Promise<DeskStatus> {
  await stopDesk()
  const cfg = normalizeDesk(config)
  const server = new DeskServer((act) => {
    if (!active?.sys.media(act)) sendMediaKey(act)
  })
  const port = await server.start()
  try {
    const rev = await adb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], 8000)
    if (rev.code !== 0) throw new Error(`adb reverse thất bại: ${(rev.stderr || rev.stdout).trim()}`)
    const url = q(`http://127.0.0.1:${port}/?k=${server.key}`)
    if (cfg.via === 'app') {
      await ensureApp(serial)
      const open = await shell(serial, `am start -n ${DESK_APP.activity} --es url ${url}`, 10_000)
      if (open.code !== 0 || /Error:/.test(open.stdout + open.stderr)) throw new Error(`không mở được app hiển thị: ${said(open)}`)
    } else {
      const open = await shell(serial, `am start -a android.intent.action.VIEW -d ${url}`, 10_000)
      if (open.code !== 0 || /Error:/.test(open.stdout + open.stderr)) throw new Error(`điện thoại không mở được trang (cần có trình duyệt): ${said(open)}`)
    }
  } catch (e) {
    await adb(['-s', serial, 'reverse', '--remove', `tcp:${port}`], 8000)
    await server.stop()
    throw e
  }
  const reader = new AiSources()
  const state = { prev: cpuTimes(), ai: undefined as AiSourceUsage[] | undefined, aiAt: 0 }
  const a: Active = { serial, port, server, via: cfg.via, config: cfg, lost: false, snap: null, sys: new SysWatcher(helperPath), ci: new CiWatcher(), timer: setInterval(() => sample(a, reader, state), 1000) }
  a.sys.start()
  active = a
  sample(a, reader, state)
  if (a.via === 'browser' && a.config.autoFull) void enterFullScreen(a)
  return deskStatus()!
}

/**
 * Browsers only go full screen after a touch, so once the page is up (its stream is connected)
 * tap the middle of the screen once. Nothing is tapped if the page never loaded.
 */
async function enterFullScreen(a: Active): Promise<void> {
  for (let i = 0; i < 40 && active === a && !a.server.viewers; i++) await new Promise((r) => setTimeout(r, 250))
  if (active !== a || !a.server.viewers) return
  await new Promise((r) => setTimeout(r, 700))
  const size = await shell(a.serial, 'wm size', 8000)
  const c = size.code === 0 ? screenCenter(size.stdout) : null
  if (c && active === a) await shell(a.serial, `input tap ${c.x} ${c.y}`, 8000)
}

/** Change what is shown without reopening the page. */
export function setDeskConfig(config: Partial<DeskConfig>): void {
  if (active) active.config = normalizeDesk(config)
}

/** Turn the board off: the viewer app is closed; a browser page stays open and says the link is gone. */
export async function stopDesk(why: 'off' | 'quit' = 'off'): Promise<void> {
  const a = active
  if (!a) return
  active = null
  clearInterval(a.timer)
  a.sys.stop()
  a.ci.stop()
  await a.server.stop()
  await adb(['-s', a.serial, 'reverse', '--remove', `tcp:${a.port}`], 8000)
  if (a.via === 'app') await shell(a.serial, `am force-stop ${DESK_APP.pkg}`, 8000)
  // ADB Kit is closing: nobody is looking at the board any more, let the phone sleep (KEYCODE_SLEEP).
  if (why === 'quit' && a.config.sleepOnQuit) await shell(a.serial, 'input keyevent 223', 8000)
}

/** A phone that was unplugged comes back without the `adb reverse` link: put it back. */
export async function deskDevicesSeen(ready: string[]): Promise<void> {
  const a = active
  if (!a) return
  if (!ready.includes(a.serial)) a.lost = true
  else if (a.lost) {
    a.lost = false
    await adb(['-s', a.serial, 'reverse', `tcp:${a.port}`, `tcp:${a.port}`], 8000)
    // The viewer app leaves after a while without ADB Kit: bring it back.
    if (a.via === 'app' && active === a) await shell(a.serial, `am start -n ${DESK_APP.activity} --es url ${q(`http://127.0.0.1:${a.port}/?k=${a.server.key}`)}`, 10_000)
  }
}
