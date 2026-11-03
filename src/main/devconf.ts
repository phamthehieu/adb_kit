import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from './adb'
import type { ConfKey, ConfResult, DevConfig } from '../shared/devconf'

/**
 * Quick device settings for testing (dark mode, font size, display size, animations, layout
 * bounds, touches). The value before ADB Kit's first change is saved to disk per device, so
 * "Khôi phục" always puts the phone back exactly as it was — even after ADB Kit was closed.
 * Never uses `wm density reset`: on some phones (Samsung with a lowered resolution) "reset"
 * jumps to the panel's native density instead of the value the phone was using.
 */
const store = (): string => join(app.getPath('userData'), 'devconf-original.json')

function loadAll(): Record<string, Partial<Record<ConfKey, string>>> {
  try {
    return existsSync(store()) ? JSON.parse(readFileSync(store(), 'utf8')) : {}
  } catch {
    return {}
  }
}
const saveAll = (all: Record<string, Partial<Record<ConfKey, string>>>): void => writeFileSync(store(), JSON.stringify(all, null, 1))

const ANIM_KEYS = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']
const SEP = '@@ADBKIT@@'

export async function getConfig(serial: string): Promise<DevConfig> {
  const cmds = [
    'am get-config | grep config:',
    'settings get system font_scale',
    'wm density',
    ...ANIM_KEYS.map((k) => `settings get global ${k}`),
    'getprop debug.layout',
    'settings get system show_touches',
    'getprop ro.build.version.sdk',
    'settings get global debug.force_rtl'
  ]
  const r = await shell(serial, cmds.join(`; echo ${SEP}; `))
  const p = r.stdout.split(SEP).map((s) => s.trim())
  const num = (s: string, d: number): number => (Number.isFinite(parseFloat(s)) ? parseFloat(s) : d)
  const dens = /Override density:\s*(\d+)/.exec(p[2])?.[1] ?? /Physical density:\s*(\d+)/.exec(p[2])?.[1] ?? '160'
  const orig = loadAll()[serial] ?? {}
  return {
    dark: /-night-/.test(p[0]),
    fontScale: num(p[1], 1),
    density: Number(dens),
    baseDensity: Number(orig.density ?? dens),
    animations: num(p[3], 1),
    layoutBounds: p[6] === 'true',
    showTouches: p[7] === '1',
    sdk: num(p[8], 0),
    rtl: p[9] === '1',
    changed: Object.keys(orig)
  }
}

/** Current value of a setting, as the string used to put it back. */
function valueOf(c: DevConfig, key: ConfKey): string {
  switch (key) {
    case 'dark':
      return c.dark ? 'yes' : 'no'
    case 'fontScale':
      return String(c.fontScale)
    case 'density':
      return String(c.density)
    case 'animations':
      return String(c.animations)
    case 'layoutBounds':
      return String(c.layoutBounds)
    case 'showTouches':
      return c.showTouches ? '1' : '0'
    case 'rtl':
      return c.rtl ? '1' : '0'
  }
}

async function apply(serial: string, key: ConfKey, value: string): Promise<string | undefined> {
  switch (key) {
    case 'dark': {
      const on = value === 'yes'
      // Remember the raw settings so a failed attempt leaves the phone exactly as it was.
      const prev = await shell(serial, 'cmd uimode night; settings get system display_night_theme')
      const prevNight = /Night mode:\s*(\w+)/.exec(prev.stdout)?.[1] ?? ''
      const prevSamsung = prev.stdout.trim().split(/\s+/).pop() ?? ''
      await shell(serial, `cmd uimode night ${on ? 'yes' : 'no'}; [ "$(getprop ro.product.manufacturer)" = samsung ] && settings put system display_night_theme ${on ? 1 : 0}`)
      await new Promise((r) => setTimeout(r, 1200))
      const now = (await getConfig(serial)).dark
      if (now !== on) {
        // Some phones (e.g. Samsung One UI) lock dark mode to their own Settings switch:
        // undo the attempt and open that switch for the tester.
        const undo = [/^(yes|no|auto)$/.test(prevNight) ? `cmd uimode night ${prevNight}` : '', /^\d+$/.test(prevSamsung) ? `settings put system display_night_theme ${prevSamsung}` : '']
        await shell(serial, undo.filter(Boolean).join('; ') || 'true')
        await shell(serial, 'am start -a android.settings.DISPLAY_SETTINGS')
        return `Máy này không cho đổi chế độ tối qua adb — đã mở Cài đặt › Màn hình trên điện thoại, hãy bật/tắt "Chế độ tối" ở đó.`
      }
      return undefined
    }
    case 'fontScale':
      await shell(serial, `settings put system font_scale ${Number(value)}`)
      return undefined
    case 'density':
      await shell(serial, `wm density ${Math.round(Number(value))}`)
      return undefined
    case 'animations':
      await shell(serial, ANIM_KEYS.map((k) => `settings put global ${k} ${Number(value)}`).join('; '))
      return undefined
    case 'layoutBounds':
      // Apps read the property when they draw; poking them (SYSPROPS_TRANSACTION) makes running
      // apps pick it up on their next frame, otherwise on the next screen.
      await shell(serial, `setprop debug.layout ${value === 'true'}; service call activity 1599295570 >/dev/null 2>&1`)
      return value === 'true' ? 'Đã bật viền layout — nếu app chưa hiện viền, chuyển màn hoặc mở lại app.' : undefined
    case 'showTouches':
      await shell(serial, `settings put system show_touches ${value === '1' ? 1 : 0}`)
      return undefined
    case 'rtl': {
      // Same as the developer option: setting + system property; apps read it when they lay out.
      const on = value === '1'
      await shell(serial, `settings put global debug.force_rtl ${on ? 1 : 0}; setprop debug.force_rtl ${on ? 'true' : 'false'}`)
      return on ? 'Đã bật bố cục phải-sang-trái — đóng rồi mở lại app để thấy (chữ vẫn là tiếng Việt, chỉ bố cục bị lật như tiếng Ả Rập).' : 'Đã tắt bố cục phải-sang-trái — mở lại app để về như cũ.'
    }
  }
}

/** Per-app language (Android 13+): `cmd locale set-app-locales`. Empty locale = follow the phone. */
export async function setAppLocale(serial: string, pkg: string, locale: string): Promise<string> {
  const sdk = Number((await shell(serial, 'getprop ro.build.version.sdk')).stdout.trim()) || 0
  if (sdk < 33) throw new Error('Đổi ngôn ngữ riêng cho app cần Android 13 trở lên. Máy cũ hơn: đổi ngôn ngữ cả máy trong Cài đặt › Quản lý chung › Ngôn ngữ.')
  if (!/^[\w.]+$/.test(pkg) || (locale && !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(locale))) throw new Error('Tham số không hợp lệ')
  const r = await shell(serial, `cmd locale set-app-locales ${pkg} --locales ${locale || '""'}`)
  if (/exception|error|unknown/i.test(r.stdout + r.stderr)) throw new Error((r.stdout + r.stderr).trim())
  return (await shell(serial, `cmd locale get-app-locales ${pkg}`)).stdout.trim()
}

export async function setConfig(serial: string, key: ConfKey, value: string): Promise<ConfResult> {
  const before = await getConfig(serial)
  const all = loadAll()
  const orig = (all[serial] ??= {})
  if (orig[key] === undefined) orig[key] = valueOf(before, key)
  const note = await apply(serial, key, value)
  // Back at the original value: nothing left to restore for this key.
  const config = await getConfig(serial)
  if (valueOf(config, key) === orig[key]) delete orig[key]
  if (!Object.keys(orig).length) delete all[serial]
  saveAll(all)
  return { config: { ...config, changed: Object.keys(all[serial] ?? {}) }, note }
}

/**
 * Really cut the phone's network (Wi-Fi + mobile data) for `seconds`, for every app including
 * native ones. The switch-back runs ON the phone in the background, so the network returns even
 * if ADB Kit or the cable goes away meanwhile. Only over USB: cutting Wi-Fi would cut a Wi-Fi
 * adb connection with no way back.
 */
export async function cutNetwork(serial: string, seconds: number): Promise<{ until: number }> {
  if (/:\d+$|_adb-tls-connect/.test(serial)) throw new Error('Máy đang nối qua Wi-Fi — tắt mạng sẽ mất kết nối adb. Hãy cắm cáp USB để dùng chức năng này.')
  const s = Math.max(2, Math.min(300, Math.round(seconds)))
  const st = await shell(serial, 'settings get global wifi_on; settings get global mobile_data')
  const [wifi, data] = st.stdout.trim().split(/\s+/)
  const back = [wifi !== '0' ? 'svc wifi enable' : '', data === '1' ? 'svc data enable' : ''].filter(Boolean).join('; ') || 'true'
  await shell(serial, `nohup sh -c 'svc wifi disable; svc data disable; sleep ${s}; ${back}' >/dev/null 2>&1 &`)
  return { until: Date.now() + s * 1000 }
}

/** Put every setting ADB Kit changed on this phone back to its original value. */
export async function restoreConfig(serial: string): Promise<ConfResult> {
  const all = loadAll()
  const orig = all[serial] ?? {}
  const notes: string[] = []
  for (const [k, v] of Object.entries(orig) as [ConfKey, string][]) {
    const n = await apply(serial, k, v)
    if (n) notes.push(n)
  }
  delete all[serial]
  saveAll(all)
  return { config: await getConfig(serial), note: notes.join(' ') || undefined }
}
