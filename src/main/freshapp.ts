import { q, shell } from './adb'
import { getPermissions, revokeAllRuntime, setRuntime } from './permissions'
import { shortPerm, type FreshMode, type FreshPerms, type PermissionInfo } from '../shared/automation'

const FIXED = /SYSTEM_FIXED|POLICY_FIXED/

/** Apps whose data must never be wiped from here: doing so breaks the phone, not the app under test. */
const PROTECTED = [/^android$/, /^com\.android\.(systemui|phone|settings|server\.telecom|bluetooth|nfc|providers\..+)$/, /^com\.google\.android\.(gms|gsf)$/]

export const isProtectedPackage = (pkg: string): boolean => PROTECTED.some((r) => r.test(pkg))

/** Runtime permissions a shell can still change (not locked by the system or a policy). */
const changeable = (list: PermissionInfo[]): PermissionInfo[] => list.filter((p) => p.kind === 'runtime' && !FIXED.test(p.flags ?? ''))

/** Background location can only be granted after the foreground one; media location after storage. */
const LAST = /ACCESS_BACKGROUND_LOCATION|ACCESS_MEDIA_LOCATION/
const byOrder = (a: PermissionInfo, b: PermissionInfo): number => Number(LAST.test(a.name)) - Number(LAST.test(b.name))

/** First useful line of a failed `pm grant`. */
const reason = (out: string): string => (out.split(/\r?\n/).find((l) => l.trim()) ?? 'thất bại').replace(/^.*Exception:\s*/, '').trim().slice(0, 120)

async function grant(serial: string, pkg: string, list: PermissionInfo[], notes: string[]): Promise<void> {
  let done = 0
  const failed: string[] = []
  for (const p of [...list].sort(byOrder)) {
    const r = await setRuntime(serial, pkg, p.name, true)
    if (r.ok) done++
    else failed.push(`${shortPerm(p.name)} (${reason(r.output)})`)
  }
  notes.push(`Đã cấp ${done} quyền${failed.length ? `; không cấp được ${failed.length}: ${failed.join(', ')}` : ''}`)
}

export interface FreshResult {
  ok: boolean
  /** Lines for the run log (what was done, and anything that could not be done). */
  notes: string[]
}

/**
 * Bring any app to a known state before testing it:
 *  - mode `stop`  → force-stop (next launch is a cold start),
 *  - mode `clear` → force-stop + `pm clear` (login, settings and caches gone, like a fresh install),
 *  then the runtime permissions follow `perms`: `keep` (re-grant what was granted before a clear),
 *  `all` (so system dialogs never block the flow) or `none` (so the app asks, to test that dialog).
 * Throws when the app is missing or the data could not be cleared; permissions the system refuses
 * to change are reported in `notes`, not thrown, because they differ per Android version.
 */
export async function freshApp(serial: string, pkg: string, mode: FreshMode, perms: FreshPerms): Promise<FreshResult> {
  const notes: string[] = []
  if (mode === 'off' && perms === 'keep') return { ok: true, notes }
  if (mode === 'clear' && isProtectedPackage(pkg)) throw new Error(`${pkg} là thành phần hệ thống — ADB Kit không xóa dữ liệu của nó`)

  // The permission list also proves the package exists (it throws "Không tìm thấy app …").
  const before = changeable(await getPermissions(serial, pkg))
  const wasGranted = before.filter((p) => p.granted)

  if (mode !== 'off') {
    await shell(serial, `am force-stop ${q(pkg)}`)
    notes.push('Đã tắt hẳn app')
  }
  if (mode === 'clear') {
    const r = await shell(serial, `pm clear ${q(pkg)}`)
    if (!/Success/.test(r.stdout)) throw new Error(`xóa dữ liệu thất bại: ${(r.stdout + r.stderr).trim() || 'không có phản hồi'}`)
    notes.push('Đã xóa dữ liệu (như mới cài)')
  }

  if (perms === 'all') {
    // After a clear most runtime permissions are reset, so read the list again.
    const now = mode === 'clear' ? changeable(await getPermissions(serial, pkg)) : before
    const todo = now.filter((p) => !p.granted)
    if (todo.length) await grant(serial, pkg, todo, notes)
    else notes.push('Mọi quyền runtime đã được cấp sẵn')
  } else if (perms === 'none') {
    if (wasGranted.length || mode === 'clear') {
      const r = await revokeAllRuntime(serial, pkg)
      notes.push(r.ok ? 'Đã thu hồi hết quyền runtime — app sẽ tự hỏi lại' : `Thu hồi quyền chưa trọn vẹn: ${reason(r.output)}`)
    } else notes.push('Không có quyền runtime nào đang được cấp')
  } else if (mode === 'clear' && wasGranted.length) {
    // `keep` across a clear: put back what the tester had granted.
    const now = changeable(await getPermissions(serial, pkg))
    const lost = now.filter((p) => !p.granted && wasGranted.some((w) => w.name === p.name))
    if (lost.length) await grant(serial, pkg, lost, notes)
  }
  return { ok: true, notes }
}
