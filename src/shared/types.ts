export interface DeviceInfo {
  serial: string
  state: string // device | unauthorized | offline | ...
  model: string
  product?: string
  transport: 'usb' | 'wifi'
}

export interface DeviceDetails {
  manufacturer: string
  model: string
  android: string
  sdk: string
  abi: string
  battery: string
  screen: string
}

export interface FileEntry {
  name: string
  type: 'dir' | 'file' | 'link' | 'other'
  size: number
  date: string
  perms: string
  owner: string
  linkTarget?: string
}

export interface MirrorOptions {
  maxSize: number
  bitRate: number
  maxFps: number
  /** Phone → PC clipboard sync (scrcpy clipboard_autosync). Default off. */
  clipboardSync?: boolean
  /** Video codec. H.265 is smaller at the same quality but untested on every phone's encoder. Default h264. */
  codec?: 'h264' | 'h265'
  /** Play the phone's sound on the PC (needs Android 11+). Default off. */
  audio?: boolean
  /** What to mirror: the screen (default) or a camera (Android 12+; no touch control). */
  source?: 'display' | 'camera-back' | 'camera-front'
  /** Show touch dots on the phone while mirroring (adb setting, restored on close). Default off. */
  showTouches?: boolean
  /** Put the phone to sleep when the mirror is closed. Default off. */
  powerOffOnClose?: boolean
}

export type VideoPacket =
  | { kind: 'session'; width: number; height: number }
  | { kind: 'config'; data: Uint8Array }
  | { kind: 'frame'; key: boolean; pts: number; data: Uint8Array }

export type MirrorStatus =
  | { state: 'idle' }
  | { state: 'starting'; serial: string }
  | { state: 'running'; serial: string; deviceName: string }
  | { state: 'error'; serial: string; message: string }

export interface InstallFlags {
  replace: boolean
  downgrade: boolean
  grant: boolean
  test: boolean
}

export interface CmdResult {
  ok: boolean
  output: string
}
