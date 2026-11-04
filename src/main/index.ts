import { app, BrowserWindow, dialog, ipcMain, shell as eShell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve as resolvePath } from 'node:path'
import { adb, adbBinary, adbPath, adbVersion, deviceDetails, installPlatformTools, listDevices, q, setOwnToolsDir, shell } from './adb'

// ADB Kit's own platform-tools copy (downloaded on demand) lives in the user data folder.
setOwnToolsDir(app.getPath('userData'))
setStateRoot(join(app.getPath('userData'), 'appstates'))
import { ScrcpySession } from './scrcpy'
import { CrashWatcher, Runner, setBaselinesRoot, type Crash } from './runner'
import { parseCli, runCli } from './cli'
import { dumpUi } from './ui'
import { SuiteRunner, readScript, readSuite, templateFor, writeManualResults, writeSuite } from './suite'
import { ReqDocStore, exportCases, fillValue, scanScreen } from './reqdoc'
import { setStateRoot, stateStore } from './appstate'
import { Stress, StressStore } from './stress'
import { liveCsv, liveReset, liveSample } from './perflive'
import { pushInfo, pushOpen, pushPost } from './push'
import type { LiveMark, LiveSample } from '../shared/perflive'
import type { PushInput } from '../shared/push'
import { captureEvidence, kbktFolder } from './manual'
import type { EvidenceInput } from '../shared/manual'
import { kbktNameOf, type ReqCase } from '../shared/reqdoc'
import { readKbkt } from './kbkt'
import { WebViewInspector } from './webview'
import { ChuckerWatcher } from './chucker'
import { getPermissions, openAppSettings, revokeAllRuntime, setAppOp, setRuntime } from './permissions'
import { freshApp } from './freshapp'
import { frameImage, getToken, listPages, loadPage, setToken } from './figma'
import { clearMiniAppCache, closeForwards, listMiniApps, listWebViews, measureOpen, openDevTools, openLink } from './miniapp'
import type { WebPage } from '../shared/miniapp'
import { discardBug, noteCall, noteError, saveBug, snapBug } from './bugquick'
import type { BugInput, Severity } from '../shared/bug'
import { createJiraIssue, getJira, setJira, testJira } from './jira'
import { dbQuery, dbTables, listAppData, readMmkv, readPrefs, writePrefs } from './appdata'
import type { PrefEntry } from '../shared/appdata'
import { OtpWatcher } from './otp'
import { ScreenRecorder } from './recorder'
import { MultiRun } from './multirun'
import { compareReports } from './compare'
import { writeTrends } from './trends'
import { appLinks, openActivity } from './applinks'
import { Explorer, type ExploreOptions } from './explore'
import type { JiraConf } from '../shared/jira'
import { cutNetwork, getConfig, restoreConfig, setAppLocale, setConfig } from './devconf'
import { clearAllLocations, clearLocation, gpsActive, moveRoute, searchPlace, setLocation, setupMapRequests } from './gps'
import type { ConfKey } from '../shared/devconf'
import { parseCsv, type FreshMode, type FreshPerms, type MockRule, type NetCall, type NetProfile, type RunOptions, type Script, type Suite } from '../shared/automation'
import {
  LogcatStream,
  ShellSession,
  installApk,
  listDir,
  listPackages,
  packageCatalog,
  foregroundPackage,
  makeDir,
  pidsOf,
  pull,
  push,
  removePath
} from './services'
import type { CmdResult, DeviceInfo, InstallFlags, MirrorOptions, MirrorStatus } from '../shared/types'

let win: BrowserWindow | null = null
const send = (channel: string, ...args: unknown[]): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

const jarPath = app.isPackaged
  ? join(process.resourcesPath, 'resources', 'scrcpy-server')
  : join(app.getAppPath(), 'resources', 'scrcpy-server')

/* ---------------------------------------------------------- device polling */

let lastDevices = ''
async function pollDevices(): Promise<void> {
  try {
    const list = await listDevices()
    const json = JSON.stringify(list)
    if (json !== lastDevices) {
      lastDevices = json
      send('devices', list)
    }
  } catch {
    /* adb server restarting; try again next tick */
  }
}
// The headless CLI run has no window: don't poll devices for it.
if (!process.argv.includes('--run')) setInterval(pollDevices, 1500)

/* -------------------------------------------------------------- mirroring */

let mirror: ScrcpySession | null = null
const setStatus = (s: MirrorStatus): void => send('mirror:status', s)

async function startMirror(serial: string, opts: MirrorOptions): Promise<void> {
  stopMirror()
  const session = new ScrcpySession(serial, jarPath, opts)
  mirror = session
  setStatus({ state: 'starting', serial })
  session.on('video', (p) => {
    if (process.env.ADBKIT_DEBUG && !(p.kind === 'frame' && !p.key))
      console.log('[mirror]', p.kind, p.kind === 'session' ? `${p.width}x${p.height}` : `${p.data.length}B`, mirror === session)
    if (mirror === session) send('mirror:video', p)
  })
  session.on('ready', (name) => {
    if (mirror === session) setStatus({ state: 'running', serial, deviceName: name })
  })
  session.on('closed', (reason) => {
    if (mirror !== session) return
    mirror = null
    setStatus(reason ? { state: 'error', serial, message: reason } : { state: 'idle' })
  })
  try {
    await session.start()
  } catch (e) {
    session.close((e as Error).message)
  }
}

function stopMirror(): void {
  const m = mirror
  mirror = null
  m?.close()
}

/* ------------------------------------------------------------ IPC handlers */

const logcat = new LogcatStream((lines) => send('logcat:lines', lines))
const term = new ShellSession(
  (d) => send('shell:data', d),
  (code) => send('shell:exit', code)
)

/* -------------------------------------------------------------- automation */

let runner: Runner | null = null
let suiteRunner: SuiteRunner | null = null
const reportsRoot = (): string => join(app.getPath('documents'), 'ADB Kit', 'reports')
const testsDir = (): string => join(app.getPath('documents'), 'ADB Kit', 'tests')
/** Evidence of manual test results (one folder per KBKT file, then per test case). */
const testTayRoot = (): string => join(app.getPath('documents'), 'ADB Kit', 'test-tay')
/** Bundled KBKT templates (BES, BCCS). */
const templatesDir = app.isPackaged ? join(process.resourcesPath, 'resources', 'templates') : join(app.getAppPath(), 'resources', 'templates')

function scriptInfo(path: string): { path: string; name: string; app: string; steps: number; error?: string } {
  try {
    const s = readScript(path)
    return { path, name: s.name, app: s.app, steps: s.steps.length }
  } catch (e) {
    return { path, name: basename(path), app: '', steps: 0, error: (e as Error).message }
  }
}

let multiRun: MultiRun | null = null
let explorer: Explorer | null = null

function registerExploreIpc(): void {
  ipcMain.handle('explore:start', async (_e, serial: string, pkg: string, opts: ExploreOptions) => {
    if (runner || suiteRunner || multiRun || explorer) throw new Error('Đang có test chạy')
    const x = new Explorer(serial, pkg, opts, (p) => send('explore:progress', p), reportsRoot())
    explorer = x
    try {
      return await x.run()
    } finally {
      if (explorer === x) explorer = null
    }
  })
  ipcMain.handle('explore:stop', () => explorer?.stop())
}

function registerSuiteIpc(): void {
  registerExploreIpc()
  // Same suite on several phones at once.
  ipcMain.handle('suite:run-multi', async (_e, serials: string[], suite: Suite, opts: RunOptions) => {
    if (runner || suiteRunner || multiRun) throw new Error('Đang có test chạy')
    if (serials.length < 1) throw new Error('Chưa chọn máy nào')
    const m = new MultiRun(serials, suite, opts, () => mirror, (ev) => send('multi:event', ev), reportsRoot(), templatesDir)
    multiRun = m
    try {
      await m.run()
    } finally {
      if (multiRun === m) multiRun = null
    }
  })
  ipcMain.handle('suite:stop-multi', () => multiRun?.stop())
  ipcMain.handle('suite:run', async (_e, serial: string, suite: Suite, opts: RunOptions) => {
    if (runner || suiteRunner || multiRun) throw new Error('Đang có test chạy')
    const s = new SuiteRunner(serial, suite, opts, () => mirror, (ev) => send('suite:event', ev), reportsRoot(), templatesDir)
    suiteRunner = s
    try {
      await s.run()
    } finally {
      if (suiteRunner === s) suiteRunner = null
    }
  })
  ipcMain.handle('suite:stop', () => suiteRunner?.stop())

  // Import test cases from an existing KBKT file (BES / BCCS layout).
  ipcMain.handle('kbkt:import', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Chọn file KBKT (kịch bản kiểm thử)',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const { layout, rows } = await readKbkt(r.filePaths[0])
    return { file: r.filePaths[0], layout, rows }
  })
  // Custom KBKT template: must have a recognisable BES / BCCS header.
  ipcMain.handle('kbkt:pick-template', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Chọn file mẫu KBKT', filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    const { layout } = await readKbkt(r.filePaths[0]).catch(() => ({ layout: null }))
    if (!layout) throw new Error('File này không đúng cấu trúc mẫu KBKT BES hoặc BCCS')
    return r.filePaths[0]
  })
  ipcMain.handle('kbkt:write-manual', async (_e, suite: Suite) => {
    if (!suite.kbkt) throw new Error('Bộ test chưa nhập file KBKT')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    // Next to the evidence folders, so the links inside the KBKT stay short and the folder can be zipped and shared.
    return writeManualResults(suite, join(testTayRoot(), kbktFolder(suite.kbkt.file), 'ket-qua', stamp))
  })
  ipcMain.handle('auto:load', (_e, path: string) => readScript(path))
  ipcMain.handle('suite:open', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Mở bộ test',
      defaultPath: testsDir(),
      filters: [{ name: 'Bộ test ADB Kit', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return { path: r.filePaths[0], suite: readSuite(r.filePaths[0]) }
  })
  ipcMain.handle('suite:save', async (_e, suite: Suite, path: string | null) => {
    let target = path
    if (!target) {
      mkdirSync(testsDir(), { recursive: true })
      const r = await dialog.showSaveDialog(win!, {
        title: 'Lưu bộ test',
        defaultPath: join(testsDir(), `BoTest_${suite.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.json`),
        filters: [{ name: 'Bộ test ADB Kit', extensions: ['json'] }]
      })
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    }
    writeSuite(target, suite)
    return target
  })
  ipcMain.handle('suite:pick-scripts', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Chọn kịch bản',
      defaultPath: testsDir(),
      filters: [{ name: 'Kịch bản ADB Kit', extensions: ['json'] }],
      properties: ['openFile', 'multiSelections']
    })
    return r.canceled ? [] : r.filePaths.map(scriptInfo)
  })
  ipcMain.handle('suite:script-info', (_e, paths: string[]) => paths.map(scriptInfo))
  ipcMain.handle('suite:pick-data', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Chọn file dữ liệu CSV',
      filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const rows = parseCsv(readFileSync(r.filePaths[0], 'utf8'))
    return { path: r.filePaths[0], rows: rows.length, columns: Object.keys(rows[0] ?? {}) }
  })
}

/* --------------------------------------------- live network / permissions */

let liveNet: WebViewInspector | null = null
let liveChucker: ChuckerWatcher | null = null
let netQueue: NetCall[] = []
setInterval(() => {
  if (!netQueue.length) return
  const batch = netQueue
  netQueue = []
  send('net:calls', batch)
}, 250)

/** Size of a directory tree in bytes. */
function dirSize(p: string): number {
  let total = 0
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name)
    total += e.isDirectory() ? dirSize(f) : statSync(f).size
  }
  return total
}

/** Run folders inside the ADB Kit reports directory (never anything else). */
function reportDirs(): { path: string; mtime: number; bytes: number }[] {
  const root = reportsRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d\d-\d\dT/.test(e.name))
    .map((e) => {
      const p = join(root, e.name)
      return { path: p, mtime: statSync(p).mtimeMs, bytes: dirSize(p) }
    })
}

function registerReportsIpc(): void {
  ipcMain.handle('reports:stats', () => {
    const dirs = reportDirs()
    return {
      count: dirs.length,
      bytes: dirs.reduce((a, d) => a + d.bytes, 0),
      oldest: dirs.length ? Math.min(...dirs.map((d) => d.mtime)) : null
    }
  })
  ipcMain.handle('reports:clean', (_e, olderThanDays: number) => {
    const cutoff = Date.now() - olderThanDays * 86_400_000
    let deleted = 0
    let freed = 0
    for (const d of reportDirs()) {
      if (d.mtime >= cutoff) continue
      rmSync(d.path, { recursive: true, force: true })
      deleted++
      freed += d.bytes
    }
    return { deleted, freed }
  })
}

function registerInspectIpc(): void {
  registerReportsIpc()
  ipcMain.handle('net:start', async (_e, serial: string, pkg: string) => {
    await liveNet?.stop()
    await liveChucker?.stop()
    liveChucker = null
    netQueue = []
    const devNow = Number((await shell(serial, 'date +%s')).stdout.trim()) * 1000 || Date.now()
    // Native apps (OkHttp + Chucker) have no WebView to inspect: read Chucker's database.
    const chk = new ChuckerWatcher(serial, pkg, { onCall: (c) => (netQueue.push(c), noteCall(pkg, c)), onInfo: (m) => send('net:info', m) }, Date.now() - 1000)
    liveChucker = chk
    const chkReady = chk.start().catch(() => false)
    const insp = new WebViewInspector(
      serial,
      pkg,
      devNow,
      {
        onCall: (c) => {
          netQueue.push(c)
          noteCall(pkg, c)
        },
        onInfo: (m) => {
          if (!m.startsWith('Không thấy cổng DevTools')) return send('net:info', m)
          // Only complain when neither source works.
          void chkReady.then((ok) => {
            if (!ok)
              send('net:info', 'Không thấy cổng DevTools của WebView, app cũng không có Chucker (cần bản build debug) — không bắt được API')
          })
        },
        onError: (e) => {
          noteError(pkg, e)
          if (e.kind !== 'network') send('net:info', `⚠ ${e.kind === 'exception' ? 'Lỗi JS' : e.kind}: ${e.message}`)
        }
      },
      { errors: true, network: true, bridge: true }
    )
    liveNet = insp
    insp.start()
  })
  ipcMain.handle('net:stop', async () => {
    await liveNet?.stop()
    liveNet = null
    await liveChucker?.stop()
    liveChucker = null
  })
  ipcMain.handle('net:reload', async (_e, serial: string, pkg: string) => {
    if (liveNet?.connected) return liveNet.reload()
    // Native app: restart it so its startup calls are captured too.
    if (liveChucker?.active && serial && pkg) {
      await shell(serial, `am force-stop ${q(pkg)}`)
      await shell(serial, `monkey -p ${q(pkg)} -c android.intent.category.LAUNCHER 1`)
      send('net:info', 'Đã khởi động lại app')
      return true
    }
    return false
  })
  // Recorded API answers ("bộ dữ liệu giả") as JSON files, for replay later or in scripts.
  ipcMain.handle('net:save-mock-set', async (_e, rules: MockRule[], name: string) => {
    mkdirSync(testsDir(), { recursive: true })
    const r = await dialog.showSaveDialog(win!, {
      title: 'Lưu bộ API đã ghi',
      defaultPath: join(testsDir(), `${name.replace(/[^\w-]+/g, '_') || 'api'}.mock.json`),
      filters: [{ name: 'Bộ API giả lập', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, JSON.stringify(rules, null, 1))
    return r.filePath
  })
  ipcMain.handle('net:open-mock-set', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Mở bộ API đã ghi', defaultPath: testsDir(), filters: [{ name: 'Bộ API giả lập', extensions: ['json'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    const rules = JSON.parse(readFileSync(r.filePaths[0], 'utf8')) as MockRule[]
    if (!Array.isArray(rules) || rules.some((x) => typeof x?.match !== 'string' || !x.action)) throw new Error('File không phải bộ API giả lập của ADB Kit')
    return { path: r.filePaths[0], rules }
  })
  ipcMain.handle('net:mocks', async (_e, rules: MockRule[]) => {
    if (!liveNet) throw new Error('Chưa theo dõi app nào')
    await liveNet.setMocks(rules)
  })
  ipcMain.handle('auto:baselines-dir', () => {
    const dir = join(app.getPath('documents'), 'ADB Kit', 'baselines')
    mkdirSync(dir, { recursive: true })
    return eShell.openPath(dir)
  })

  ipcMain.handle('perm:list', (_e, serial: string, pkg: string) => getPermissions(serial, pkg))
  ipcMain.handle('perm:set', (_e, serial: string, pkg: string, perm: string, grant: boolean) => setRuntime(serial, pkg, perm, grant))
  ipcMain.handle('perm:appop', (_e, serial: string, pkg: string, op: string, mode: string) => setAppOp(serial, pkg, op, mode))
  ipcMain.handle('perm:revoke-all', (_e, serial: string, pkg: string) => revokeAllRuntime(serial, pkg))
  ipcMain.handle('perm:fresh', async (_e, serial: string, pkg: string, mode: FreshMode, perms: FreshPerms): Promise<CmdResult> => {
    try {
      const r = await freshApp(serial, pkg, mode, perms)
      return { ok: true, output: r.notes.join('\n') }
    } catch (e) {
      return { ok: false, output: (e as Error).message }
    }
  })
  ipcMain.handle('perm:settings', (_e, serial: string, pkg: string) => openAppSettings(serial, pkg))
}

function registerFigmaIpc(): void {
  ipcMain.handle('figma:has-token', () => !!getToken())
  ipcMain.handle('figma:set-token', (_e, token: string) => setToken(token))
  ipcMain.handle('figma:pages', (_e, fileKey: string) => listPages(fileKey))
  ipcMain.handle('figma:load', (_e, fileKey: string, nodeId: string, refresh: boolean) => loadPage(fileKey, nodeId, refresh))
  ipcMain.handle('figma:image', (_e, fileKey: string, nodeId: string) => frameImage(fileKey, nodeId))
  // dp = px / (density / 160); the override (Settings → display size) wins over the panel's.
  ipcMain.handle('device:density', async (_e, serial: string) => {
    const out = (await shell(serial, 'wm density')).stdout
    const m = /Override density:\s*(\d+)/.exec(out) ?? /Physical density:\s*(\d+)/.exec(out)
    return m ? Number(m[1]) : 160
  })
}

function registerMiniAppIpc(): void {
  ipcMain.handle('mini:webviews', (_e, serial: string) => listWebViews(serial))
  ipcMain.handle('mini:devtools', (_e, serial: string, socket: string, page: WebPage) => openDevTools(serial, socket, page))
  ipcMain.handle('mini:list', (_e, serial: string, pkg: string) => listMiniApps(serial, pkg))
  ipcMain.handle('mini:clear-cache', (_e, serial: string, pkg: string, appId: string) => clearMiniAppCache(serial, pkg, appId))
  ipcMain.handle('mini:open-link', (_e, serial: string, url: string, pkg?: string) => openLink(serial, url, pkg))
  ipcMain.handle('mini:measure', (_e, serial: string, pkg: string, url: string, appId?: string, cold?: boolean) => measureOpen(serial, pkg, url, appId, cold))
  app.on('will-quit', () => void closeForwards())
}

function registerDevConfIpc(): void {
  ipcMain.handle('conf:get', (_e, serial: string) => getConfig(serial))
  ipcMain.handle('conf:set', (_e, serial: string, key: ConfKey, value: string) => setConfig(serial, key, value))
  ipcMain.handle('conf:restore', (_e, serial: string) => restoreConfig(serial))
  ipcMain.handle('net:cut', (_e, serial: string, seconds: number) => cutNetwork(serial, seconds))
  ipcMain.handle('conf:app-locale', (_e, serial: string, pkg: string, locale: string) => setAppLocale(serial, pkg, locale))
  ipcMain.handle('gps:set', (_e, serial: string, lat: number, lng: number) => setLocation(serial, lat, lng))
  ipcMain.handle('gps:route', (_e, serial: string, from: [number, number], to: [number, number], seconds: number) => moveRoute(serial, from, to, seconds))
  ipcMain.handle('gps:clear', (_e, serial: string) => clearLocation(serial))
  ipcMain.handle('gps:active', (_e, serial: string) => gpsActive(serial))
  ipcMain.handle('gps:search', (_e, query: string, near?: [number, number]) => searchPlace(query, near))
  setupMapRequests()
  // Never leave a fake location behind when ADB Kit closes.
  app.on('before-quit', () => void clearAllLocations())
  ipcMain.handle('net:profile', (_e, p: NetProfile | null) => liveNet?.setProfile(p))
}

/* Background crash / ANR watch for the device on screen (outside test runs too). */
let bgCrash: { serial: string; w: CrashWatcher } | null = null
function registerCrashIpc(): void {
  ipcMain.handle('crash:watch', (_e, serial: string | null) => {
    if (bgCrash?.serial === serial) return
    bgCrash?.w.stop()
    bgCrash = null
    if (!serial) return
    const last = new Map<string, number>()
    const w = new CrashWatcher(serial, (c: Crash) => {
      // A crash loop fires again and again: one notice per app every 30 s is enough.
      const key = `${c.type}|${c.pkg}`
      if (Date.now() - (last.get(key) ?? 0) < 30_000) return
      last.set(key, Date.now())
      send('crash:event', { serial, type: c.type, pkg: c.pkg, summary: c.summary, lines: c.lines.slice(0, 40), at: Date.now() })
    })
    bgCrash = { serial, w }
  })
  app.on('will-quit', () => bgCrash?.w.stop())
}

/* Manual screen recording (screenrecord on the phone → MP4 in Videos/ADB Kit). */
let manualRec: { serial: string; rec: ScreenRecorder; dir: string; started: number } | null = null
function registerRecordIpc(): void {
  ipcMain.handle('rec:start', (_e, serial: string) => {
    if (manualRec) throw new Error('Đang quay rồi')
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dir = join(app.getPath('videos'), 'ADB Kit', `quay-${stamp}`)
    mkdirSync(dir, { recursive: true })
    const rec = new ScreenRecorder(serial, dir)
    rec.start()
    manualRec = { serial, rec, dir, started: Date.now() }
    return manualRec.started
  })
  ipcMain.handle('rec:stop', async () => {
    const r = manualRec
    manualRec = null
    if (!r) return null
    const files = await r.rec.stop()
    if (!files.length) {
      rmSync(r.dir, { recursive: true, force: true })
      throw new Error('Không lấy được video từ máy')
    }
    return join(r.dir, files[0])
  })
  app.on('will-quit', () => void manualRec?.rec.stop())
}

/* App data (debuggable apps) and one-time codes. */
const otpWatchers = new Map<string, OtpWatcher>()
function registerDataIpc(): void {
  ipcMain.handle('data:list', (_e, serial: string, pkg: string) => listAppData(serial, pkg))
  ipcMain.handle('data:prefs', (_e, serial: string, pkg: string, path: string) => readPrefs(serial, pkg, path))
  ipcMain.handle('data:save-prefs', (_e, serial: string, pkg: string, path: string, entries: PrefEntry[]) => writePrefs(serial, pkg, path, entries))
  ipcMain.handle('data:tables', (_e, serial: string, pkg: string, path: string) => dbTables(serial, pkg, path))
  ipcMain.handle('data:query', (_e, serial: string, pkg: string, path: string, sql: string) => dbQuery(serial, pkg, path, sql))
  ipcMain.handle('data:mmkv', (_e, serial: string, pkg: string, path: string) => readMmkv(serial, pkg, path))
  ipcMain.handle('links:list', (_e, serial: string, pkg: string) => appLinks(serial, pkg))
  ipcMain.handle('links:open-activity', (_e, serial: string, pkg: string, activity: string) => openActivity(serial, pkg, activity))
  // OTP: start() remembers the notifications already on the phone; poll() returns new codes.
  ipcMain.handle('otp:start', (_e, serial: string) => void otpWatchers.set(serial, new OtpWatcher(serial)))
  ipcMain.handle('otp:poll', (_e, serial: string) => otpWatchers.get(serial)?.poll() ?? [])
  ipcMain.handle('otp:stop', (_e, serial: string) => void otpWatchers.delete(serial))
  // Type text on the phone with `input text` (ASCII); the renderer pastes anything else.
  ipcMain.handle('device:type', (_e, serial: string, text: string) => shell(serial, `input text ${q(text.replace(/ /g, '%s'))}`))
}

/* BA requirement documents: import, browse, check the phone screen against them, export KBKT. */
function registerReqDocIpc(): void {
  const store = new ReqDocStore(join(app.getPath('userData'), 'reqdocs'))
  ipcMain.handle('req:import', async (_e, path?: string) => {
    if (!path) {
      const r = await dialog.showOpenDialog({ title: 'Chọn tài liệu yêu cầu (TLNV / MTYCTD)', properties: ['openFile'], filters: [{ name: 'Word', extensions: ['docx'] }] })
      if (r.canceled || !r.filePaths[0]) return null
      path = r.filePaths[0]
    }
    return store.import(path)
  })
  ipcMain.handle('req:list', () => store.list())
  ipcMain.handle('req:get', (_e, id: string) => store.get(id))
  ipcMain.handle('req:remove', (_e, id: string) => store.remove(id))
  ipcMain.handle('req:image', (_e, id: string, name: string) => store.image(id, name))
  ipcMain.handle('req:scan', (_e, serial: string) => scanScreen(serial))
  ipcMain.handle('req:fill', (_e, serial: string, value: string, label?: string) => fillValue(serial, value, label))
  ipcMain.handle('req:export-kbkt', async (_e, id: string, cases: ReqCase[], meta: { template: string; code: string; author: string; tester: string }) => {
    const doc = store.get(id)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dir = join(reportsRoot(), `${stamp}_KBKT-TU-TAI-LIEU`)
    mkdirSync(dir, { recursive: true })
    const template = templateFor({ template: meta.template } as Suite, templatesDir)
    const out = await exportCases(cases, join(dir, kbktNameOf(doc.file)), template, { title: doc.title, code: meta.code, author: meta.author, tester: meta.tester })
    eShell.showItemInFolder(out)
    return out
  })
}

function registerJiraIpc(): void {
  ipcMain.handle('jira:get', () => getJira())
  ipcMain.handle('jira:set', (_e, conf: JiraConf, token?: string) => setJira(conf, token))
  ipcMain.handle('jira:test', (_e, conf?: JiraConf, token?: string) => testJira(conf, token))
  // Only files of a bug report folder inside ADB Kit's reports directory can be attached.
  ipcMain.handle('jira:create', (_e, input: { summary: string; markdown: string; severity: Severity; dir: string }) => {
    const root = reportsRoot()
    const dir = resolvePath(input.dir)
    if (!dir.startsWith(resolvePath(root)) || !existsSync(dir)) throw new Error('Thư mục báo cáo không hợp lệ')
    const files = readdirSync(dir)
      .filter((f) => f === 'screenshot.png' || f.endsWith('.zip'))
      .map((f) => join(dir, f))
    return createJiraIssue({ summary: input.summary, markdown: input.markdown, severity: input.severity, files })
  })
  ipcMain.handle('os:open-external', (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Chỉ mở được link http(s)')
    return eShell.openExternal(url)
  })
}

/** Test-bench tools: manual KBKT testing with evidence, saved app states, and durability ("độ bền") tests. */
function registerToolsIpc(): void {
  const states = stateStore()
  const stress = new Stress(new StressStore(join(app.getPath('userData'), 'stress-state.json')))
  const modelOf = async (serial: string): Promise<string> => (await listDevices()).find((d) => d.serial === serial)?.model ?? serial

  // Manual testing with evidence
  ipcMain.handle('manual:capture', (_e, serial: string, input: EvidenceInput) => captureEvidence(serial, testTayRoot(), input))
  ipcMain.handle('manual:open-root', async () => {
    mkdirSync(testTayRoot(), { recursive: true })
    return eShell.openPath(testTayRoot())
  })
  ipcMain.handle('manual:reveal', (_e, path: string) => {
    if (path) eShell.showItemInFolder(path)
  })

  // Saved app states (login, settings, local data)
  ipcMain.handle('state:list', (_e, pkg?: string) => states.list(pkg))
  ipcMain.handle('state:save', async (_e, serial: string, pkg: string, name: string, note: string) => states.save(serial, pkg, name, note, await modelOf(serial)))
  ipcMain.handle('state:restore', (_e, serial: string, id: string, launch?: boolean) => states.restore(serial, id, { launch }))
  ipcMain.handle('state:rename', (_e, id: string, name: string, note?: string) => states.rename(id, name, note))
  ipcMain.handle('state:remove', (_e, id: string) => states.remove(id))
  ipcMain.handle('state:export', async (_e, id: string) => {
    const meta = states.list().find((m) => m.id === id)
    if (!meta) throw new Error('Không tìm thấy trạng thái')
    const r = await dialog.showSaveDialog(win!, {
      title: 'Xuất trạng thái app',
      defaultPath: join(app.getPath('documents'), `${meta.name.replace(/[\\/:*?"<>|]+/g, '_')}.adbstate`),
      filters: [{ name: 'Trạng thái app ADB Kit', extensions: ['adbstate'] }]
    })
    if (r.canceled || !r.filePath) return null
    await states.exportTo(id, r.filePath)
    return r.filePath
  })
  ipcMain.handle('state:import', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Nhập trạng thái app', filters: [{ name: 'Trạng thái app ADB Kit', extensions: ['adbstate'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    return states.importFrom(r.filePaths[0])
  })
  ipcMain.handle('state:usage', () => states.usage())

  // Durability tests
  ipcMain.handle('stress:status', (_e, serial: string) => stress.status(serial))
  ipcMain.handle('stress:apply', (_e, serial: string, id: string, value: string, pkg?: string) => stress.apply(serial, id, value, pkg))
  ipcMain.handle('stress:restore', (_e, serial: string, id?: string, pkg?: string) => stress.restore(serial, id, pkg))

  // Live performance of the app under test
  ipcMain.handle('perf:sample', (_e, serial: string, pkg: string, t0: number) => liveSample(serial, pkg, t0))
  ipcMain.handle('perf:reset', (_e, serial: string, pkg: string) => liveReset(serial, pkg))
  ipcMain.handle('perf:export', async (_e, pkg: string, samples: LiveSample[], marks: LiveMark[]) => {
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const r = await dialog.showSaveDialog(win!, {
      title: 'Lưu số liệu hiệu năng',
      defaultPath: join(app.getPath('documents'), `hieu-nang_${pkg.replace(/[^\w.-]+/g, '_') || 'app'}_${stamp}.csv`),
      filters: [{ name: 'CSV (mở bằng Excel)', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, liveCsv(samples, marks))
    return r.filePath
  })

  // Notification tests (no server / Firebase key)
  ipcMain.handle('push:info', (_e, serial: string, pkg: string) => pushInfo(serial, pkg))
  ipcMain.handle('push:post', (_e, serial: string, input: PushInput) => pushPost(serial, input))
  ipcMain.handle('push:open', (_e, serial: string, input: PushInput) => pushOpen(serial, input))
}

function registerBugIpc(): void {
  registerDevConfIpc()
  registerJiraIpc()
  registerCrashIpc()
  registerDataIpc()
  registerRecordIpc()
  registerReqDocIpc()
  registerToolsIpc()
  ipcMain.handle('bug:snap', (_e, serial: string) => snapBug(serial, reportsRoot()))
  ipcMain.handle('bug:save', (_e, id: string, input: BugInput) => saveBug(id, input))
  ipcMain.handle('bug:discard', (_e, id: string) => discardBug(id))
}

function registerAutomationIpc(): void {
  registerBugIpc()
  registerSuiteIpc()
  registerInspectIpc()
  registerFigmaIpc()
  registerMiniAppIpc()
  ipcMain.handle('ui:dump', (_e, serial: string) => dumpUi(serial))

  ipcMain.handle('auto:run', async (_e, serial: string, script: Script, opts: RunOptions) => {
    if (runner || suiteRunner) throw new Error('Đang có test chạy')
    const r = new Runner(serial, script, opts, () => mirror, (ev) => send('auto:event', ev), reportsRoot())
    runner = r
    try {
      await r.run()
    } catch (e) {
      send('auto:event', { kind: 'end', result: 'failed', message: `Lỗi bộ chạy: ${(e as Error).message}` })
    } finally {
      if (runner === r) runner = null
    }
  })
  ipcMain.handle('auto:stop', () => runner?.stop())

  ipcMain.handle('auto:open', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Mở kịch bản',
      filters: [{ name: 'ADB Kit test', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const script = JSON.parse(readFileSync(r.filePaths[0], 'utf8')) as Script
    if (!Array.isArray(script.steps)) throw new Error('Không phải kịch bản của ADB Kit')
    return { path: r.filePaths[0], script }
  })
  ipcMain.handle('auto:save', async (_e, script: Script, path: string | null) => {
    let target = path
    if (!target) {
      const dir = join(app.getPath('documents'), 'ADB Kit', 'tests')
      mkdirSync(dir, { recursive: true })
      const r = await dialog.showSaveDialog(win!, {
        title: 'Lưu kịch bản',
        defaultPath: join(dir, `${script.name.replace(/[^\w-]+/g, '_') || 'test'}.json`),
        filters: [{ name: 'ADB Kit test', extensions: ['json'] }]
      })
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    }
    writeFileSync(target, JSON.stringify(script, null, 2))
    return target
  })
  ipcMain.handle('os:open', (_e, path: string) => eShell.openPath(path))
  ipcMain.handle('auto:reports-dir', () => {
    mkdirSync(reportsRoot(), { recursive: true })
    return eShell.openPath(reportsRoot())
  })
  ipcMain.handle('auto:trends', async () => {
    mkdirSync(reportsRoot(), { recursive: true })
    const file = writeTrends(reportsRoot())
    await eShell.openPath(file)
    return file
  })
  // Compare two runs: pick the older then the newer report folder.
  ipcMain.handle('auto:compare', async () => {
    mkdirSync(reportsRoot(), { recursive: true })
    const pick = async (title: string): Promise<string | null> => {
      const r = await dialog.showOpenDialog(win!, { title, defaultPath: reportsRoot(), properties: ['openDirectory'] })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    }
    const a = await pick('Chọn thư mục báo cáo LẦN TRƯỚC (bản cũ)')
    if (!a) return null
    const b = await pick('Chọn thư mục báo cáo LẦN NÀY (bản mới)')
    if (!b) return null
    const file = compareReports(a, b, reportsRoot())
    await eShell.openPath(file)
    return file
  })
}

function registerIpc(): void {
  registerAutomationIpc()
  ipcMain.handle('adb:info', async () => ({ path: adbPath(), version: await adbVersion() }))
  ipcMain.handle('adb:install', async () => {
    const path = await installPlatformTools()
    await pollDevices()
    return { path, version: await adbVersion() }
  })
  ipcMain.handle('devices:list', async () => {
    const list: DeviceInfo[] = await listDevices()
    lastDevices = JSON.stringify(list)
    return list
  })
  ipcMain.handle('device:details', (_e, serial: string) => deviceDetails(serial))
  ipcMain.handle('device:connect', async (_e, addr: string) => {
    const r = await adb(['connect', addr], 15_000)
    const out = (r.stdout + r.stderr).trim()
    return { ok: /connected to/.test(out) && !/cannot|failed/.test(out), output: out }
  })
  ipcMain.handle('device:pair', async (_e, addr: string, code: string) => {
    const r = await adb(['pair', addr, code], 30_000)
    const out = (r.stdout + r.stderr).trim()
    return { ok: /Successfully paired/.test(out), output: out }
  })
  ipcMain.handle('device:disconnect', async (_e, serial: string) => {
    const r = await adb(['disconnect', serial])
    return { ok: r.code === 0, output: (r.stdout + r.stderr).trim() }
  })
  ipcMain.handle('device:tcpip', async (_e, serial: string) => {
    // Find the Wi-Fi IP first, switch adbd to TCP mode, then connect to it.
    const ip = await adb(['-s', serial, 'shell', 'ip -f inet addr show wlan0'])
    const m = /inet ([\d.]+)/.exec(ip.stdout)
    if (!m) return { ok: false, output: 'Thiết bị chưa có IP Wi-Fi (wlan0). Hãy kết nối Wi-Fi trước.' }
    await adb(['-s', serial, 'tcpip', '5555'])
    await new Promise((r) => setTimeout(r, 1500))
    const c = await adb(['connect', `${m[1]}:5555`], 15_000)
    const out = (c.stdout + c.stderr).trim()
    return { ok: /connected to/.test(out), output: out }
  })

  ipcMain.handle('mirror:start', (_e, serial: string, opts: MirrorOptions) => startMirror(serial, opts))
  ipcMain.handle('mirror:stop', () => stopMirror())
  ipcMain.on('mirror:control', (_e, bytes: Uint8Array) => mirror?.sendControl(bytes))

  // Auto-rotate would immediately undo a manual rotation (the phone lying flat reads as portrait),
  // so switch it off before asking scrcpy to rotate. Returns whether it was on.
  ipcMain.handle('device:disable-auto-rotate', async (_e, serial: string) => {
    const r = await shell(serial, 'settings get system accelerometer_rotation')
    const wasOn = r.stdout.trim() === '1'
    if (wasOn) await shell(serial, 'settings put system accelerometer_rotation 0')
    return wasOn
  })

  // Raw PNG, used as a placeholder until the encoder emits its first frame
  // (some devices only encode once the screen content changes).
  ipcMain.handle('device:screencap', (_e, serial: string) => adbBinary(['-s', serial, 'exec-out', 'screencap', '-p']))
  ipcMain.handle('device:screenshot', async (_e, serial: string) => {
    const png = await adbBinary(['-s', serial, 'exec-out', 'screencap', '-p'])
    const dir = join(app.getPath('pictures'), 'ADB Kit')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = join(dir, `screenshot-${stamp}.png`)
    writeFileSync(file, png)
    return file
  })
  ipcMain.handle('os:reveal', (_e, path: string) => eShell.showItemInFolder(path))

  ipcMain.handle('apk:pick', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Chọn file APK',
      filters: [{ name: 'Gói Android', extensions: ['apk'] }],
      properties: ['openFile']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('apk:install', (_e, serial: string, apk: string, flags: InstallFlags) => installApk(serial, apk, flags))

  ipcMain.handle('logcat:start', (_e, serial: string) => logcat.start(serial))
  ipcMain.handle('logcat:stop', () => logcat.stop())
  ipcMain.handle('logcat:clear', (_e, serial: string) => adb(['-s', serial, 'logcat', '-c']))
  ipcMain.handle('apps:list', (_e, serial: string) => listPackages(serial))
  ipcMain.handle('apps:catalog', (_e, serial: string) => packageCatalog(serial))
  ipcMain.handle('apps:foreground', (_e, serial: string) => foregroundPackage(serial))
  ipcMain.handle('apps:pids', (_e, serial: string, pkg: string) => pidsOf(serial, pkg))

  ipcMain.handle('shell:start', (_e, serial: string, cols: number, rows: number) => term.start(serial, cols, rows))
  ipcMain.on('shell:write', (_e, data: string) => term.write(data))
  ipcMain.handle('shell:stop', () => term.stop())

  ipcMain.handle('files:list', (_e, serial: string, path: string) => listDir(serial, path))
  ipcMain.handle('files:remove', (_e, serial: string, path: string) => removePath(serial, path))
  ipcMain.handle('files:mkdir', (_e, serial: string, path: string) => makeDir(serial, path))
  ipcMain.handle('files:push', (_e, serial: string, locals: string[], remoteDir: string) => push(serial, locals, remoteDir))
  ipcMain.handle('files:pick-and-push', async (_e, serial: string, remoteDir: string) => {
    const r = await dialog.showOpenDialog(win!, { title: 'Tải lên thiết bị', properties: ['openFile', 'multiSelections'] })
    if (r.canceled || !r.filePaths.length) return null
    return push(serial, r.filePaths, remoteDir)
  })
  ipcMain.handle('files:pull', async (_e, serial: string, remote: string, isDir: boolean) => {
    const name = basename(remote)
    const r = isDir
      ? await dialog.showOpenDialog(win!, { title: `Lưu "${name}" vào thư mục`, properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showSaveDialog(win!, { title: 'Tải về từ thiết bị', defaultPath: name })
    const target = 'filePaths' in r ? r.filePaths?.[0] : r.filePath
    if (r.canceled || !target) return null
    const res = await pull(serial, remote, target)
    return { ...res, path: isDir ? join(target, name) : target }
  })
}

/* ------------------------------------------------------------------ window */

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    title: 'ADB Kit',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // Keep the mirror and long test runs updating while the window is behind others.
      backgroundThrottling: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

const cli = parseCli(process.argv)

app.whenReady().then(async () => {
  setBaselinesRoot(join(app.getPath('documents'), 'ADB Kit', 'baselines'))
  if (cli) {
    // Headless run (CI / scheduled): no window, exit code tells the result.
    const code = await runCli(cli, reportsRoot(), templatesDir)
    app.exit(code)
    return
  }
  registerIpc()
  createWindow()
})

app.on('before-quit', () => {
  runner?.stop()
  suiteRunner?.stop()
  void liveNet?.stop()
  stopMirror()
  logcat.stop()
  term.stop()
})
app.on('window-all-closed', () => app.quit())
