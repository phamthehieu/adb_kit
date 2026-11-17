import { app, shell as eShell } from 'electron'
// Named import on purpose: the main bundle is CommonJS and electron-updater marks itself as an
// ES module without a default export, so a default import would be undefined at startup.
import { autoUpdater } from 'electron-updater'
import { RELEASES_URL, updateMode, type UpdateInfo, type UpdateState } from '../shared/update'

let state: UpdateState = { state: 'idle' }
let emit: (s: UpdateState) => void = () => {}
/** Version offered by the last successful check. */
let offered = ''
/** The running check was started by the user: report problems instead of staying silent. */
let byUser = false

function set(s: UpdateState): void {
  state = s
  emit(s)
}

const mode = (): ReturnType<typeof updateMode> => updateMode(process.platform, !!process.env.APPIMAGE)

export const updateInfo = (): UpdateInfo => ({ current: app.getVersion(), state })

/**
 * Looks for a newer release on GitHub once, shortly after start. Nothing is downloaded or
 * installed until the user asks: a tester may be in the middle of a run.
 */
export function initUpdater(send: (s: UpdateState) => void): void {
  emit = send
  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (i) => {
    offered = i.version
    set({ state: 'available', version: offered, mode: mode() })
  })
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: offered, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => set({ state: 'ready', version: offered }))
  autoUpdater.on('error', (e) => {
    // A failed background check (offline, no release published yet) is not worth a message.
    const loud = byUser || state.state === 'downloading'
    set(loud ? { state: 'error', message: (e?.message ?? String(e)).split('\n')[0].slice(0, 200) } : { state: 'idle' })
  })
  setTimeout(() => void checkForUpdate(false), 15_000)
}

export async function checkForUpdate(manual: boolean): Promise<UpdateInfo> {
  if (!app.isPackaged) {
    if (manual) set({ state: 'error', message: 'bản chạy dev không tự cập nhật' })
    return updateInfo()
  }
  if (state.state === 'checking' || state.state === 'downloading' || state.state === 'ready') return updateInfo()
  byUser = manual
  set({ state: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    /* reported by the 'error' event */
  }
  // The events above have changed `state` by now; if none fired, do not stay on "checking".
  if (updateInfo().state.state === 'checking') set({ state: 'idle' })
  return updateInfo()
}

/** Download the offered build, or open the download page where self-install is not possible. */
export async function downloadUpdate(): Promise<void> {
  if (state.state !== 'available') return
  if (state.mode === 'page') {
    await eShell.openExternal(RELEASES_URL)
    return
  }
  set({ state: 'downloading', version: offered, percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch {
    /* reported by the 'error' event */
  }
}

/** Close ADB Kit, install the downloaded build and start it again. */
export function installUpdate(): void {
  if (state.state === 'ready') autoUpdater.quitAndInstall(true, true)
}
