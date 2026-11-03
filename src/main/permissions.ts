import { q, shell } from './adb'
import type { CmdResult } from '../shared/types'
import type { PermissionInfo } from '../shared/automation'

/** Special ("appop") permissions: granted through Settings, toggled with `cmd appops set`. */
const SPECIAL_OPS: Record<string, string> = {
  'android.permission.SYSTEM_ALERT_WINDOW': 'SYSTEM_ALERT_WINDOW',
  'android.permission.REQUEST_INSTALL_PACKAGES': 'REQUEST_INSTALL_PACKAGES',
  'android.permission.SCHEDULE_EXACT_ALARM': 'SCHEDULE_EXACT_ALARM',
  'android.permission.WRITE_SETTINGS': 'WRITE_SETTINGS',
  'android.permission.PACKAGE_USAGE_STATS': 'GET_USAGE_STATS',
  'android.permission.MANAGE_EXTERNAL_STORAGE': 'MANAGE_EXTERNAL_STORAGE',
  'android.permission.USE_FULL_SCREEN_INTENT': 'USE_FULL_SCREEN_INTENT',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS': 'RUN_ANY_IN_BACKGROUND'
}

/** App-op that records usage of a runtime permission (for "last used"). */
function opForRuntime(perm: string): string {
  const s = perm.replace('android.permission.', '')
  if (s === 'ACCESS_FINE_LOCATION') return 'FINE_LOCATION'
  if (s === 'ACCESS_COARSE_LOCATION') return 'COARSE_LOCATION'
  if (s === 'ACCESS_BACKGROUND_LOCATION') return 'FINE_LOCATION'
  return s
}

/** "+3d1h20m42s727ms" → milliseconds. */
function parseAgo(t: string): number {
  let ms = 0
  for (const m of t.matchAll(/(\d+)(ms|d|h|m|s)/g)) {
    const n = Number(m[1])
    ms += m[2] === 'd' ? n * 86_400_000 : m[2] === 'h' ? n * 3_600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1000 : n
  }
  return ms
}

export function agoText(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} giây trước`
  if (s < 3600) return `${Math.round(s / 60)} phút trước`
  if (s < 86_400) return `${Math.round(s / 3600)} giờ trước`
  return `${Math.round(s / 86_400)} ngày trước`
}

export interface AppOp {
  mode: string
  /** ms since the app last used it (if known). */
  agoMs?: number
}

/** `cmd appops get <pkg>` → op → mode / last access. */
export async function appOps(serial: string, pkg: string): Promise<Record<string, AppOp>> {
  const r = await shell(serial, `cmd appops get ${q(pkg)}`)
  const out: Record<string, AppOp> = {}
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+):\s*([a-z_]+)(.*)$/.exec(line)
    if (!m) continue
    const t = /time=\+?([0-9dhms]+) ago/.exec(m[3]) ?? /time=\+?([0-9dhms]+)/.exec(m[3])
    // Newer Android prints mode then "; rejectTime=…" etc. Keep the most recent access.
    out[m[1]] = { mode: m[2], agoMs: t ? parseAgo(t[1]) : undefined }
  }
  return out
}

export async function getPermissions(serial: string, pkg: string): Promise<PermissionInfo[]> {
  const [dump, ops] = await Promise.all([shell(serial, `dumpsys package ${q(pkg)}`), appOps(serial, pkg)])
  const text = dump.stdout
  if (!/Package \[/.test(text)) throw new Error(`Không tìm thấy app ${pkg}`)

  // Section parser: "requested permissions:", "install permissions:", "runtime permissions:".
  const requested = new Set<string>()
  const install = new Map<string, boolean>()
  const runtime = new Map<string, { granted: boolean; flags?: string }>()
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === 'requested permissions:') section = 'req'
    else if (line === 'install permissions:') section = 'install'
    else if (line === 'runtime permissions:') section = 'runtime'
    else {
      // "android.permission.X" or "android.permission.X: granted=true, flags=[ … ]"
      const m = /^([A-Za-z][\w.]*\.[\w.]+)(?::\s*granted=(true|false)(?:,\s*flags=\[\s*([^\]]*)\])?)?$/.exec(line)
      if (!m) {
        section = '' // any other line ends the current list
        continue
      }
      if (section === 'req') requested.add(m[1])
      else if (section === 'install' && m[2]) install.set(m[1], m[2] === 'true')
      else if (section === 'runtime' && m[2]) runtime.set(m[1], { granted: m[2] === 'true', flags: m[3]?.trim() || undefined })
    }
  }

  const out: PermissionInfo[] = []
  const used = (op?: string): Pick<PermissionInfo, 'lastUsed' | 'lastUsedMs'> => {
    const a = op ? ops[op]?.agoMs : undefined
    return a !== undefined ? { lastUsedMs: a, lastUsed: agoText(a) } : {}
  }
  const all = new Set([...requested, ...install.keys(), ...runtime.keys()])
  for (const name of all) {
    const special = SPECIAL_OPS[name]
    if (special) {
      const mode = ops[special]?.mode ?? 'default'
      out.push({ name, kind: 'special', op: special, mode, granted: mode === 'allow' ? true : mode === 'default' ? null : false, ...used(special) })
    } else if (runtime.has(name)) {
      const r = runtime.get(name)!
      const op = opForRuntime(name)
      out.push({ name, kind: 'runtime', granted: r.granted, flags: r.flags, op, ...used(op) })
    } else if (install.has(name)) {
      out.push({ name, kind: 'install', granted: install.get(name)!, ...used(opForRuntime(name)) })
    } else {
      // Requested but unknown to this Android version (e.g. POST_NOTIFICATIONS before 13).
      out.push({ name, kind: 'install', granted: null })
    }
  }
  const order = { runtime: 0, special: 1, install: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
}

const res = (r: { code: number; stdout: string; stderr: string }): CmdResult => {
  const output = (r.stdout + r.stderr).trim()
  return { ok: r.code === 0 && !/Exception|Error|not a changeable|Unknown/i.test(output), output }
}

export async function setRuntime(serial: string, pkg: string, perm: string, grant: boolean): Promise<CmdResult> {
  return res(await shell(serial, `pm ${grant ? 'grant' : 'revoke'} ${q(pkg)} ${q(perm)}`))
}

export async function setAppOp(serial: string, pkg: string, op: string, mode: string): Promise<CmdResult> {
  return res(await shell(serial, `cmd appops set ${q(pkg)} ${q(op)} ${q(mode)}`))
}

/** Revoke every granted, user-changeable runtime permission. Android kills the app when this happens. */
export async function revokeAllRuntime(serial: string, pkg: string): Promise<CmdResult> {
  const perms = (await getPermissions(serial, pkg)).filter((p) => p.kind === 'runtime' && p.granted && !/SYSTEM_FIXED|POLICY_FIXED/.test(p.flags ?? ''))
  const outs: string[] = []
  let ok = true
  for (const p of perms) {
    const r = await setRuntime(serial, pkg, p.name, false)
    ok &&= r.ok
    outs.push(`${p.name.replace('android.permission.', '')}: ${r.ok ? 'đã thu hồi' : r.output}`)
  }
  return { ok, output: outs.join('\n') || 'Không có quyền runtime nào đang được cấp' }
}

export async function openAppSettings(serial: string, pkg: string): Promise<CmdResult> {
  return res(await shell(serial, `am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d ${q(`package:${pkg}`)}`))
}
