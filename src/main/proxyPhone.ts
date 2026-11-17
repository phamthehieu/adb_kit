// Phone side of the capturing proxy: point the phone's global HTTP proxy at ADB Kit (through
// `adb reverse`, so it works over USB with no Wi-Fi set-up) and ALWAYS put the old value back.
//
// The phone has no internet while its proxy points at a dead port, so the original value is
// written to disk before anything is changed and restored on stop, on quit, when the phone
// reconnects, and at the next start if ADB Kit was killed in between.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { adb, shell } from './adb'
import { ProxyServer, createCa, type CaFiles, type ProxyHandlers } from './proxy'
import { normalizeProxySetting, type ProxyStatus } from '../shared/proxy'

interface Saved {
  serial: string
  port: number
  /** Value of `settings get global http_proxy` before ADB Kit changed it ('' = none). */
  prev: string
}

let root = ''
let active: (Saved & { server: ProxyServer; decrypt: boolean; lost: boolean; info?: (m: string) => void }) | null = null

export function setProxyRoot(dir: string): void {
  root = dir
}

const statePath = (): string => join(root, 'active.json')
const caCertPath = (): string => join(root, 'adbkit-proxy-ca.crt')

function readSaved(): Saved | null {
  try {
    const s = JSON.parse(readFileSync(statePath(), 'utf8')) as Saved
    return typeof s.serial === 'string' && typeof s.port === 'number' && typeof s.prev === 'string' ? s : null
  } catch {
    return null
  }
}

/** The CA of this PC, created on first use. The private key stays in ADB Kit's data folder. */
function loadCa(): CaFiles {
  mkdirSync(root, { recursive: true })
  const keyFile = join(root, 'ca-key.pem')
  if (existsSync(keyFile) && existsSync(caCertPath())) return { keyPem: readFileSync(keyFile, 'utf8'), certPem: readFileSync(caCertPath(), 'utf8') }
  const ca = createCa()
  writeFileSync(keyFile, ca.keyPem, { mode: 0o600 })
  writeFileSync(caCertPath(), ca.certPem)
  return ca
}

/** Put the phone's proxy setting back. False when the phone could not be reached. */
async function restore(s: Saved): Promise<boolean> {
  const put = await shell(s.serial, `settings put global http_proxy ${s.prev || ':0'}`, 8000)
  if (put.code !== 0) return false
  await adb(['-s', s.serial, 'reverse', '--remove', `tcp:${s.port}`], 8000)
  rmSync(statePath(), { force: true })
  return true
}

export const proxyStatus = (): ProxyStatus | null => (active ? { serial: active.serial, port: active.port, decrypt: active.decrypt } : null)

export async function startPhoneProxy(serial: string, decrypt: boolean, h: ProxyHandlers): Promise<ProxyStatus> {
  await stopPhoneProxy()
  mkdirSync(root, { recursive: true })
  // A leftover from a session that never got to clean up: undo it first so its original value
  // (not our own dead proxy) is what gets recorded below.
  const stale = readSaved()
  if (stale && !(await restore(stale)) && stale.serial === serial) throw new Error('không trả lại được thiết lập proxy cũ của điện thoại')

  const server = new ProxyServer(h, { ca: decrypt ? loadCa() : undefined })
  const port = await server.start()
  try {
    const rev = await adb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], 8000)
    if (rev.code !== 0) throw new Error(`adb reverse thất bại: ${(rev.stderr || rev.stdout).trim()}`)
    const got = await shell(serial, 'settings get global http_proxy', 8000)
    if (got.code !== 0) throw new Error(`không đọc được thiết lập proxy của điện thoại: ${got.stderr.trim()}`)
    const saved: Saved = { serial, port, prev: normalizeProxySetting(got.stdout) }
    writeFileSync(statePath(), JSON.stringify(saved)) // before the change, so a crash can be undone
    const put = await shell(serial, `settings put global http_proxy 127.0.0.1:${port}`, 8000)
    if (put.code !== 0) {
      await restore(saved)
      throw new Error(`điện thoại không cho đổi proxy: ${(put.stderr || put.stdout).trim()}`)
    }
    active = { ...saved, server, decrypt, lost: false, info: h.onInfo }
    return proxyStatus()!
  } catch (e) {
    await adb(['-s', serial, 'reverse', '--remove', `tcp:${port}`], 8000)
    await server.stop()
    throw e
  }
}

/** Turn the proxy off and give the phone its setting back. Safe to call when nothing is on. */
export async function stopPhoneProxy(): Promise<boolean> {
  const a = active
  if (!a) return true
  active = null
  const ok = await restore(a)
  await a.server.stop()
  return ok
}

/**
 * Called on every device poll with the phones that are ready.
 *  - A phone that dropped off while the proxy was on comes back without the `adb reverse`
 *    link, i.e. with a proxy that leads nowhere: switch it off as soon as it is seen again.
 *  - A setting left behind by a killed ADB Kit is restored the first time its phone shows up.
 */
export async function proxyDevicesSeen(ready: string[]): Promise<void> {
  if (active) {
    const here = ready.includes(active.serial)
    if (!here) active.lost = true
    else if (active.lost) {
      const info = active.info
      await stopPhoneProxy()
      info?.('Điện thoại vừa kết nối lại: đã tắt proxy và trả lại thiết lập mạng cũ. Bật lại proxy nếu muốn bắt tiếp.')
    }
    return
  }
  if (!root || !existsSync(statePath())) return
  const s = readSaved()
  if (!s) return rmSync(statePath(), { force: true })
  if (ready.includes(s.serial)) await restore(s)
}

/**
 * Copy the CA certificate to the phone's Download folder and open the security settings; the
 * user installs it there by hand (Android does not let adb install a CA).
 */
export async function pushProxyCa(serial: string): Promise<string> {
  loadCa()
  const remote = '/sdcard/Download/adbkit-proxy-ca.crt'
  const push = await adb(['-s', serial, 'push', caCertPath(), remote], 20_000)
  if (push.code !== 0) throw new Error(`không chép được chứng chỉ lên máy: ${(push.stderr || push.stdout).trim()}`)
  await shell(serial, 'am start -a android.settings.SECURITY_SETTINGS', 8000)
  return remote
}
