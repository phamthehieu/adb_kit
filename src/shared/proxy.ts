// Capturing proxy: what the main process and the Network panel share.

export interface ProxyStatus {
  serial: string
  port: number
  /** HTTPS is decrypted with ADB Kit's CA (apps that trust it) instead of only listing hosts. */
  decrypt: boolean
}

/**
 * `settings get global http_proxy` prints "null" when the setting does not exist and ":0" when
 * it was cleared; both mean "no proxy". Anything else is kept exactly, to be put back later.
 */
export function normalizeProxySetting(out: string): string {
  const v = out.trim()
  if (!v || v === 'null' || v === ':0') return ''
  // Only a plain host:port can be written back safely through the shell.
  return /^[A-Za-z0-9.\-_[\]:]+:\d{1,5}$/.test(v) ? v : ''
}

/** Run by hand if a phone was ever left pointing at a proxy that is gone. */
export const PROXY_RESET_COMMAND = 'adb shell settings put global http_proxy :0'
