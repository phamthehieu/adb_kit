import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  CmdResult,
  DeviceDetails,
  DeviceInfo,
  FileEntry,
  InstallFlags,
  MirrorOptions,
  MirrorStatus,
  VideoPacket
} from '../shared/types'
import type {
  KbktImport,
  FreshMode,
  FreshPerms,
  MockRule,
  MultiEvent,
  NetProfile,
  NetCall,
  PermissionInfo,
  RunEvent,
  RunOptions,
  Script,
  ScriptInfo,
  Suite,
  SuiteEvent,
  UiNode
} from '../shared/automation'
import type { FPage, FPageRef } from '../shared/figma'
import type { AppStateMeta, AppStateResult } from '../shared/appstate'
import type { EvidenceInput, EvidenceResult } from '../shared/manual'
import type { StressResult, StressStatus } from '../shared/stress'
import type { LiveMark, LiveSample } from '../shared/perflive'
import type { PushInfo, PushInput, PushResult } from '../shared/push'
import type { MiniAppList, OpenTiming, WebPage, WebViewProc } from '../shared/miniapp'
import type { BugInput, BugResult, BugSnap, Severity } from '../shared/bug'
import type { JiraCheck, JiraConf, JiraIssue, JiraState } from '../shared/jira'
import type { DataFile, DbResult, DbTable, MmkvEntry, PrefEntry } from '../shared/appdata'
import type { AppLink, AppScreen } from '../main/applinks'
import type { ExploreOptions, ExploreProgress } from '../main/explore'
import type { ReqCase, ReqDoc, ReqDocInfo, ScreenScan } from '../shared/reqdoc'

export interface CrashEvent {
  serial: string
  type: 'crash' | 'anr' | 'native'
  pkg: string
  summary: string
  lines: string[]
  at: number
}
export interface OtpHit {
  code: string
  pkg: string
  title: string
  seenAt: number
}
import type { ConfKey, ConfResult, DevConfig } from '../shared/devconf'

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api = {
  adbInfo: (): Promise<{ path: string; version: string }> => invoke('adb:info'),
  installAdb: (): Promise<{ path: string; version: string }> => invoke('adb:install'),
  listDevices: (): Promise<DeviceInfo[]> => invoke('devices:list'),
  onDevices: (cb: (list: DeviceInfo[]) => void) => on('devices', cb),
  details: (serial: string): Promise<DeviceDetails> => invoke('device:details', serial),
  connect: (addr: string): Promise<CmdResult> => invoke('device:connect', addr),
  pair: (addr: string, code: string): Promise<CmdResult> => invoke('device:pair', addr, code),
  disconnect: (serial: string): Promise<CmdResult> => invoke('device:disconnect', serial),
  enableWifi: (serial: string): Promise<CmdResult> => invoke('device:tcpip', serial),
  screenshot: (serial: string): Promise<string> => invoke('device:screenshot', serial),
  disableAutoRotate: (serial: string): Promise<boolean> => invoke('device:disable-auto-rotate', serial),
  screencap: (serial: string): Promise<Uint8Array> => invoke('device:screencap', serial),
  reveal: (path: string): Promise<void> => invoke('os:reveal', path),

  mirror: {
    start: (serial: string, opts: MirrorOptions): Promise<void> => invoke('mirror:start', serial, opts),
    stop: (): Promise<void> => invoke('mirror:stop'),
    control: (bytes: Uint8Array): void => ipcRenderer.send('mirror:control', bytes),
    onVideo: (cb: (p: VideoPacket) => void) => on('mirror:video', cb),
    onStatus: (cb: (s: MirrorStatus) => void) => on('mirror:status', cb)
  },

  apk: {
    pick: (): Promise<string | null> => invoke('apk:pick'),
    install: (serial: string, path: string, flags: InstallFlags): Promise<CmdResult> =>
      invoke('apk:install', serial, path, flags)
  },

  logcat: {
    start: (serial: string): Promise<void> => invoke('logcat:start', serial),
    stop: (): Promise<void> => invoke('logcat:stop'),
    clear: (serial: string): Promise<void> => invoke('logcat:clear', serial),
    onLines: (cb: (lines: string[]) => void) => on('logcat:lines', cb)
  },
  apps: {
    list: (serial: string): Promise<string[]> => invoke('apps:list', serial),
    catalog: (serial: string): Promise<{ all: string[]; user: string[] }> => invoke('apps:catalog', serial),
    foreground: (serial: string): Promise<string | null> => invoke('apps:foreground', serial),
    pids: (serial: string, pkg: string): Promise<number[]> => invoke('apps:pids', serial, pkg)
  },

  shell: {
    start: (serial: string, cols: number, rows: number): Promise<void> => invoke('shell:start', serial, cols, rows),
    write: (data: string): void => ipcRenderer.send('shell:write', data),
    stop: (): Promise<void> => invoke('shell:stop'),
    onData: (cb: (d: string) => void) => on('shell:data', cb),
    onExit: (cb: (code: number | null) => void) => on('shell:exit', cb)
  },

  files: {
    list: (serial: string, path: string): Promise<{ entries: FileEntry[]; error?: string }> =>
      invoke('files:list', serial, path),
    remove: (serial: string, path: string): Promise<CmdResult> => invoke('files:remove', serial, path),
    mkdir: (serial: string, path: string): Promise<CmdResult> => invoke('files:mkdir', serial, path),
    push: (serial: string, locals: string[], dir: string): Promise<CmdResult> => invoke('files:push', serial, locals, dir),
    pickAndPush: (serial: string, dir: string): Promise<CmdResult | null> => invoke('files:pick-and-push', serial, dir),
    pull: (serial: string, remote: string, isDir: boolean): Promise<(CmdResult & { path: string }) | null> =>
      invoke('files:pull', serial, remote, isDir)
  },

  automation: {
    dumpUi: (serial: string): Promise<{ nodes: UiNode[]; width: number; height: number }> => invoke('ui:dump', serial),
    run: (serial: string, script: Script, opts: RunOptions): Promise<void> => invoke('auto:run', serial, script, opts),
    stop: (): Promise<void> => invoke('auto:stop'),
    onEvent: (cb: (e: RunEvent) => void) => on('auto:event', cb),
    open: (): Promise<{ path: string; script: Script } | null> => invoke('auto:open'),
    load: (path: string): Promise<Script> => invoke('auto:load', path),
    save: (script: Script, path: string | null): Promise<string | null> => invoke('auto:save', script, path),
    openReportsDir: (): Promise<string> => invoke('auto:reports-dir'),
    compareRuns: (): Promise<string | null> => invoke('auto:compare'),
    trends: (): Promise<string> => invoke('auto:trends'),
    openBaselinesDir: (): Promise<string> => invoke('auto:baselines-dir'),
    reportStats: (): Promise<{ count: number; bytes: number; oldest: number | null }> => invoke('reports:stats'),
    cleanReports: (olderThanDays: number): Promise<{ deleted: number; freed: number }> => invoke('reports:clean', olderThanDays)
  },
  suite: {
    run: (serial: string, suite: Suite, opts: RunOptions): Promise<void> => invoke('suite:run', serial, suite, opts),
    stop: (): Promise<void> => invoke('suite:stop'),
    onEvent: (cb: (e: SuiteEvent) => void) => on('suite:event', cb),
    runMulti: (serials: string[], suite: Suite, opts: RunOptions): Promise<void> => invoke('suite:run-multi', serials, suite, opts),
    explore: (serial: string, pkg: string, opts: ExploreOptions): Promise<string> => invoke('explore:start', serial, pkg, opts),
    stopExplore: (): Promise<void> => invoke('explore:stop'),
    onExplore: (cb: (p: ExploreProgress) => void) => on('explore:progress', cb),
    stopMulti: (): Promise<void> => invoke('suite:stop-multi'),
    onMulti: (cb: (e: MultiEvent) => void) => on('multi:event', cb),
    open: (): Promise<{ path: string; suite: Suite } | null> => invoke('suite:open'),
    save: (suite: Suite, path: string | null): Promise<string | null> => invoke('suite:save', suite, path),
    pickScripts: (): Promise<ScriptInfo[]> => invoke('suite:pick-scripts'),
    scriptInfo: (paths: string[]): Promise<ScriptInfo[]> => invoke('suite:script-info', paths),
    pickData: (): Promise<{ path: string; rows: number; columns: string[] } | null> => invoke('suite:pick-data'),
    importKbkt: (): Promise<KbktImport | null> => invoke('kbkt:import'),
    pickTemplate: (): Promise<string | null> => invoke('kbkt:pick-template'),
    writeManual: (suite: Suite): Promise<{ path: string; count: number }> => invoke('kbkt:write-manual', suite)
  },
  net: {
    start: (serial: string, pkg: string): Promise<void> => invoke('net:start', serial, pkg),
    stop: (): Promise<void> => invoke('net:stop'),
    reload: (serial?: string, pkg?: string): Promise<boolean> => invoke('net:reload', serial, pkg),
    setMocks: (rules: MockRule[]): Promise<void> => invoke('net:mocks', rules),
    setProfile: (p: NetProfile | null): Promise<void> => invoke('net:profile', p),
    saveMockSet: (rules: MockRule[], name: string): Promise<string | null> => invoke('net:save-mock-set', rules, name),
    openMockSet: (): Promise<{ path: string; rules: MockRule[] } | null> => invoke('net:open-mock-set'),
    cut: (serial: string, seconds: number): Promise<{ until: number }> => invoke('net:cut', serial, seconds),
    onCalls: (cb: (calls: NetCall[]) => void) => on('net:calls', cb),
    onInfo: (cb: (msg: string) => void) => on('net:info', cb)
  },
  /** Manual testing against a KBKT file, with evidence saved for each result. */
  manual: {
    capture: (serial: string, input: EvidenceInput): Promise<EvidenceResult> => invoke('manual:capture', serial, input),
    openRoot: (): Promise<string> => invoke('manual:open-root'),
    reveal: (path: string): Promise<void> => invoke('manual:reveal', path)
  },
  /** Saved copies of an app's private data (debuggable apps). */
  appState: {
    list: (pkg?: string): Promise<AppStateMeta[]> => invoke('state:list', pkg),
    save: (serial: string, pkg: string, name: string, note: string): Promise<AppStateResult> => invoke('state:save', serial, pkg, name, note),
    restore: (serial: string, id: string, launch?: boolean): Promise<AppStateResult> => invoke('state:restore', serial, id, launch),
    rename: (id: string, name: string, note?: string): Promise<AppStateMeta> => invoke('state:rename', id, name, note),
    remove: (id: string): Promise<void> => invoke('state:remove', id),
    export: (id: string): Promise<string | null> => invoke('state:export', id),
    import: (): Promise<AppStateMeta | null> => invoke('state:import'),
    usage: (): Promise<number> => invoke('state:usage')
  },
  /** "Độ bền": put the phone or an app into awkward situations and back. */
  stress: {
    status: (serial: string): Promise<StressStatus> => invoke('stress:status', serial),
    apply: (serial: string, id: string, value: string, pkg?: string): Promise<StressResult> => invoke('stress:apply', serial, id, value, pkg),
    restore: (serial: string, id?: string, pkg?: string): Promise<StressResult> => invoke('stress:restore', serial, id, pkg)
  },
  perf: {
    sample: (serial: string, pkg: string, t0: number): Promise<LiveSample> => invoke('perf:sample', serial, pkg, t0),
    reset: (serial: string, pkg: string): Promise<void> => invoke('perf:reset', serial, pkg),
    exportCsv: (pkg: string, samples: LiveSample[], marks: LiveMark[]): Promise<string | null> => invoke('perf:export', pkg, samples, marks)
  },
  push: {
    info: (serial: string, pkg: string): Promise<PushInfo> => invoke('push:info', serial, pkg),
    post: (serial: string, input: PushInput): Promise<PushResult> => invoke('push:post', serial, input),
    open: (serial: string, input: PushInput): Promise<PushResult> => invoke('push:open', serial, input)
  },
  perms: {
    list: (serial: string, pkg: string): Promise<PermissionInfo[]> => invoke('perm:list', serial, pkg),
    set: (serial: string, pkg: string, perm: string, grant: boolean): Promise<CmdResult> => invoke('perm:set', serial, pkg, perm, grant),
    appop: (serial: string, pkg: string, op: string, mode: string): Promise<CmdResult> => invoke('perm:appop', serial, pkg, op, mode),
    revokeAll: (serial: string, pkg: string): Promise<CmdResult> => invoke('perm:revoke-all', serial, pkg),
    fresh: (serial: string, pkg: string, mode: FreshMode, perms: FreshPerms): Promise<CmdResult> => invoke('perm:fresh', serial, pkg, mode, perms),
    openSettings: (serial: string, pkg: string): Promise<CmdResult> => invoke('perm:settings', serial, pkg)
  },
  figma: {
    hasToken: (): Promise<boolean> => invoke('figma:has-token'),
    setToken: (token: string): Promise<void> => invoke('figma:set-token', token),
    pages: (fileKey: string): Promise<{ fileName: string; pages: FPageRef[] }> => invoke('figma:pages', fileKey),
    load: (fileKey: string, nodeId: string, refresh = false): Promise<FPage> => invoke('figma:load', fileKey, nodeId, refresh),
    image: (fileKey: string, nodeId: string): Promise<Uint8Array> => invoke('figma:image', fileKey, nodeId),
    density: (serial: string): Promise<number> => invoke('device:density', serial)
  },
  crash: {
    watch: (serial: string | null): Promise<void> => invoke('crash:watch', serial),
    onEvent: (cb: (e: CrashEvent) => void) => on('crash:event', cb)
  },
  data: {
    list: (serial: string, pkg: string): Promise<DataFile[]> => invoke('data:list', serial, pkg),
    prefs: (serial: string, pkg: string, path: string): Promise<PrefEntry[]> => invoke('data:prefs', serial, pkg, path),
    savePrefs: (serial: string, pkg: string, path: string, entries: PrefEntry[]): Promise<void> => invoke('data:save-prefs', serial, pkg, path, entries),
    tables: (serial: string, pkg: string, path: string): Promise<DbTable[]> => invoke('data:tables', serial, pkg, path),
    query: (serial: string, pkg: string, path: string, sql: string): Promise<DbResult> => invoke('data:query', serial, pkg, path, sql),
    mmkv: (serial: string, pkg: string, path: string): Promise<MmkvEntry[]> => invoke('data:mmkv', serial, pkg, path)
  },
  links: {
    list: (serial: string, pkg: string): Promise<{ links: AppLink[]; screens: AppScreen[] }> => invoke('links:list', serial, pkg),
    openActivity: (serial: string, pkg: string, activity: string): Promise<string> => invoke('links:open-activity', serial, pkg, activity)
  },
  otp: {
    start: (serial: string): Promise<void> => invoke('otp:start', serial),
    poll: (serial: string): Promise<OtpHit[]> => invoke('otp:poll', serial),
    stop: (serial: string): Promise<void> => invoke('otp:stop', serial)
  },
  typeText: (serial: string, text: string): Promise<unknown> => invoke('device:type', serial, text),
  gps: {
    set: (serial: string, lat: number, lng: number): Promise<void> => invoke('gps:set', serial, lat, lng),
    route: (serial: string, from: [number, number], to: [number, number], seconds: number): Promise<void> => invoke('gps:route', serial, from, to, seconds),
    clear: (serial: string): Promise<void> => invoke('gps:clear', serial),
    active: (serial: string): Promise<boolean> => invoke('gps:active', serial),
    search: (query: string, near?: [number, number]): Promise<{ name: string; lat: number; lng: number }[]> => invoke('gps:search', query, near)
  },
  rec: {
    start: (serial: string): Promise<number> => invoke('rec:start', serial),
    stop: (): Promise<string | null> => invoke('rec:stop')
  },
  conf: {
    get: (serial: string): Promise<DevConfig> => invoke('conf:get', serial),
    set: (serial: string, key: ConfKey, value: string): Promise<ConfResult> => invoke('conf:set', serial, key, value),
    restore: (serial: string): Promise<ConfResult> => invoke('conf:restore', serial),
    appLocale: (serial: string, pkg: string, locale: string): Promise<string> => invoke('conf:app-locale', serial, pkg, locale)
  },
  jira: {
    get: (): Promise<JiraState> => invoke('jira:get'),
    set: (conf: JiraConf, token?: string): Promise<JiraState> => invoke('jira:set', conf, token),
    test: (conf?: JiraConf, token?: string): Promise<JiraCheck> => invoke('jira:test', conf, token),
    create: (input: { summary: string; markdown: string; severity: Severity; dir: string }): Promise<JiraIssue> => invoke('jira:create', input)
  },
  openExternal: (url: string): Promise<void> => invoke('os:open-external', url),
  bug: {
    snap: (serial: string): Promise<BugSnap> => invoke('bug:snap', serial),
    save: (id: string, input: BugInput): Promise<BugResult> => invoke('bug:save', id, input),
    discard: (id: string): Promise<void> => invoke('bug:discard', id)
  },
  mini: {
    webviews: (serial: string): Promise<WebViewProc[]> => invoke('mini:webviews', serial),
    devtools: (serial: string, socket: string, page: WebPage): Promise<void> => invoke('mini:devtools', serial, socket, page),
    list: (serial: string, pkg: string): Promise<MiniAppList> => invoke('mini:list', serial, pkg),
    clearCache: (serial: string, pkg: string, appId: string): Promise<void> => invoke('mini:clear-cache', serial, pkg, appId),
    openLink: (serial: string, url: string, pkg?: string): Promise<string> => invoke('mini:open-link', serial, url, pkg),
    measure: (serial: string, pkg: string, url: string, appId?: string, cold?: boolean): Promise<OpenTiming> =>
      invoke('mini:measure', serial, pkg, url, appId, cold)
  },
  /** BA requirement documents (TLNV / MTYCTD .docx). */
  req: {
    /** Without a path: pick the .docx in a dialog (null = cancelled). */
    import: (path?: string): Promise<ReqDoc | null> => invoke('req:import', path),
    list: (): Promise<ReqDocInfo[]> => invoke('req:list'),
    get: (id: string): Promise<ReqDoc> => invoke('req:get', id),
    remove: (id: string): Promise<void> => invoke('req:remove', id),
    image: (id: string, name: string): Promise<string> => invoke('req:image', id, name),
    scan: (serial: string): Promise<ScreenScan> => invoke('req:scan', serial),
    fill: (serial: string, value: string, label?: string): Promise<string> => invoke('req:fill', serial, value, label),
    exportKbkt: (id: string, cases: ReqCase[], meta: { template: string; code: string; author: string; tester: string }): Promise<string> =>
      invoke('req:export-kbkt', id, cases, meta)
  },
  openPath: (path: string): Promise<string> => invoke('os:open', path),

  /** Absolute path of a File from a drag & drop event. */
  pathForFile: (f: File): string => webUtils.getPathForFile(f)
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
