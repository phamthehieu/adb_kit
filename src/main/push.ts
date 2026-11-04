import { q, shell } from './adb'
import type { PushExtra, PushInfo, PushInput, PushResult } from '../shared/push'

/**
 * Notification tests that need no server and no Firebase key.
 *
 * What this CAN do: post a real system notification whose tap opens the app the way a push does
 * (launcher + extras, or a deep link), and open the app that way directly.
 * What it CANNOT do: deliver a Firebase message INTO the app — Android only lets Google's own
 * app send that broadcast, and the shell is refused. Those tests still need FCM / the Firebase console.
 */

const bad = (message: string): PushResult => ({ ok: false, message })

/** Spaces would split the intent spec of `cmd notification post -c`, so extras and links may not hold any. */
function checkWords(p: Pick<PushInput, 'link' | 'extras' | 'tap'>): string | null {
  if (p.tap === 'link' && !/^[a-z][\w+.-]*:\/\/\S+$/i.test(p.link.trim())) return 'Liên kết phải có dạng scheme://đường-dẫn và không có dấu cách (vd. myapp://order/123).'
  for (const e of p.extras) {
    if (!e.key.trim()) return 'Có dòng dữ liệu đính kèm chưa có tên khóa.'
    if (/\s/.test(e.key) || /\s/.test(e.value)) return `Dữ liệu đính kèm “${e.key} = ${e.value}” có dấu cách — hãy bỏ dấu cách (dùng dấu gạch hoặc mã hóa %20).`
  }
  return null
}

const extraArgs = (extras: PushExtra[]): string => extras.filter((e) => e.key.trim()).map((e) => ` --es ${e.key.trim()} ${e.value}`).join('')

/** The `-c` value: what tapping the notification starts. */
export function contentIntent(p: PushInput, launcher: string | null): string | null {
  if (p.tap === 'none') return null
  if (p.tap === 'link') return `activity -a android.intent.action.VIEW -d ${p.link.trim()} -p ${p.pkg}${extraArgs(p.extras)}`
  if (!launcher) return null
  return `activity -n ${launcher}${extraArgs(p.extras)}`
}

export function postCommand(p: PushInput, launcher: string | null): string {
  const intent = contentIntent(p, launcher)
  const parts = ['cmd notification post', `-t ${q(p.title || 'ADB Kit')}`]
  if (p.style === 'bigtext') parts.push('-S bigtext')
  if (intent) parts.push(`-c ${q(intent)}`)
  parts.push(q('adbkit'), q(p.text || ' '))
  return parts.join(' ')
}

export async function pushInfo(serial: string, pkg: string): Promise<PushInfo> {
  const sdk = Number((await shell(serial, 'getprop ro.build.version.sdk')).stdout.trim()) || 0
  const act = (await shell(serial, `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${q(pkg)} | tail -n 1`)).stdout.trim()
  const rec = (await shell(serial, `cmd package query-receivers --brief -a com.google.android.c2dm.intent.RECEIVE -p ${q(pkg)}`)).stdout
  let postPermission: PushInfo['postPermission'] = null
  if (sdk >= 33) {
    const d = (await shell(serial, `dumpsys package ${q(pkg)} | grep -m1 'android.permission.POST_NOTIFICATIONS'`)).stdout
    postPermission = /granted=true/.test(d) ? 'granted' : 'denied'
  }
  return { launcher: /^[\w.]+\/[\w.$]+$/.test(act) ? act : null, fcm: /receivers? found/i.test(rec) && !/No receivers/i.test(rec), postPermission, sdk }
}

/** Post a notification from the shell. Tapping it starts the chosen screen of the app. */
export async function pushPost(serial: string, p: PushInput): Promise<PushResult> {
  if (!p.pkg && p.tap !== 'none') return bad('Hãy chọn app cần test trước.')
  const err = checkWords(p)
  if (err) return bad(err)
  let launcher: string | null = null
  if (p.tap === 'app') {
    launcher = (await pushInfo(serial, p.pkg)).launcher
    if (!launcher) return bad('App này không có màn hình mở từ launcher, hãy chọn “mở liên kết”.')
  }
  const r = await shell(serial, postCommand(p, launcher), 20_000)
  const out = `${r.stdout}\n${r.stderr}`.trim()
  if (/exception|error|unknown|usage:/i.test(out)) return bad(`Máy không nhận lệnh: ${out.split(/\r?\n/).slice(0, 3).join(' | ')}`)
  const what = p.tap === 'none' ? 'Chạm vào chỉ đóng thông báo.' : p.tap === 'link' ? 'Chạm vào sẽ mở liên kết trong app.' : 'Chạm vào sẽ mở app kèm dữ liệu đã nhập.'
  return { ok: true, message: `Đã đăng thông báo — kéo thanh thông báo xuống để xem. ${what}` }
}

/** Open the app exactly the way a tapped notification would, without posting anything. */
export async function pushOpen(serial: string, p: Pick<PushInput, 'pkg' | 'link' | 'extras' | 'tap'>): Promise<PushResult> {
  if (!p.pkg) return bad('Hãy chọn app cần test trước.')
  const err = checkWords({ ...p, tap: p.tap === 'link' ? 'link' : 'app' })
  if (err) return bad(err)
  let cmd: string
  if (p.tap === 'link') {
    cmd = `am start -a android.intent.action.VIEW -d ${q(p.link.trim())} -p ${q(p.pkg)}${p.extras.filter((e) => e.key.trim()).map((e) => ` --es ${q(e.key.trim())} ${q(e.value)}`).join('')}`
  } else {
    const launcher = (await pushInfo(serial, p.pkg)).launcher
    if (!launcher) return bad('App này không có màn hình mở từ launcher.')
    cmd = `am start -n ${q(launcher)}${p.extras.filter((e) => e.key.trim()).map((e) => ` --es ${q(e.key.trim())} ${q(e.value)}`).join('')}`
  }
  const r = await shell(serial, cmd, 20_000)
  const out = `${r.stdout}\n${r.stderr}`.trim()
  if (/error|exception|unable/i.test(out)) return bad(`Máy không mở được: ${out.split(/\r?\n/).slice(0, 3).join(' | ')}`)
  return { ok: true, message: 'Đã mở app như khi chạm vào thông báo. Quan sát: app có tới đúng màn hình và đọc đúng dữ liệu không?' }
}
