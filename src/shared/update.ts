// In-app update: shared between the main process (electron-updater) and the top bar.

/** Where a tester downloads a build by hand. */
export const RELEASES_URL = 'https://github.com/phamthehieu/adb_kit/releases/latest'

/**
 * 'install' = ADB Kit downloads the new build and installs it on restart.
 * 'page'    = only tell the user and open the download page.
 */
export type UpdateMode = 'install' | 'page'

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'available'; version: string; mode: UpdateMode }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export interface UpdateInfo {
  /** Version of the running app. */
  current: string
  state: UpdateState
}

/**
 * Self-install works for the Windows installer and the Linux AppImage. A macOS build that is not
 * code-signed cannot replace itself, and a .deb is owned by the system package manager.
 */
export function updateMode(platform: string, isAppImage: boolean): UpdateMode {
  if (platform === 'win32') return 'install'
  if (platform === 'linux' && isAppImage) return 'install'
  return 'page'
}

/** One line for the settings popover. */
export function updateText(info: UpdateInfo): string {
  const s = info.state
  switch (s.state) {
    case 'checking':
      return 'Đang kiểm tra bản mới…'
    case 'none':
      return `Đang dùng bản mới nhất (${info.current})`
    case 'available':
      return `Có bản mới ${s.version} (đang dùng ${info.current})`
    case 'downloading':
      return `Đang tải bản ${s.version}: ${s.percent}%`
    case 'ready':
      return `Bản ${s.version} đã tải xong — khởi động lại để cài`
    case 'error':
      return `Không kiểm tra được bản mới: ${s.message}`
    default:
      return `Phiên bản ${info.current}`
  }
}
