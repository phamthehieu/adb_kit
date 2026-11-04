import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { q, shell } from './adb'
import { STRESS_ITEMS, type StressApplied, type StressItem, type StressResult, type StressStatus } from '../shared/stress'

/**
 * Put a phone into the awkward situations real users meet (see shared/stress.ts). Every change that
 * alters a setting first records what it was, in a file on this PC, so "Khôi phục" can undo it even
 * after ADB Kit was closed in between. Nothing here needs root; some phones refuse some commands,
 * and then the result says so instead of pretending.
 */

let delayScale = 1
/** Tests shorten the waits. */
export const setDelayScale = (n: number): void => {
  delayScale = n
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms * delayScale))

interface Ctx {
  serial: string
  pkg: string
  sdk: number
}
type Orig = Record<string, string>
interface Saved {
  label: string
  value: string
  at: number
  orig: Orig
  /** The app the change was made for (items that are per-app). */
  pkg?: string
}
type Db = Record<string, Record<string, Saved>> // serial -> item id -> saved

/** Where the originals are remembered. */
export class StressStore {
  constructor(private readonly file: string) {}
  private read(): Db {
    try {
      return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Db) : {}
    } catch {
      return {}
    }
  }
  private write(db: Db): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(db, null, 2))
  }
  all(serial: string): Record<string, Saved> {
    return this.read()[serial] ?? {}
  }
  set(serial: string, id: string, s: Saved): void {
    const db = this.read()
    ;(db[serial] ??= {})[id] = s
    this.write(db)
  }
  /** Keep the FIRST original when the same item is applied twice. */
  setKeepingOrig(serial: string, id: string, s: Saved): void {
    const prev = this.all(serial)[id]
    this.set(serial, id, prev ? { ...s, orig: prev.orig, at: prev.at } : s)
  }
  del(serial: string, id: string): void {
    const db = this.read()
    if (db[serial]) delete db[serial][id]
    this.write(db)
  }
}

/* ------------------------------------------------------------------ helpers */

const out = async (ctx: Ctx, cmd: string, timeout?: number): Promise<string> => {
  const r = await shell(ctx.serial, cmd, timeout)
  return (r.stdout + r.stderr).trim()
}

const getSetting = async (ctx: Ctx, ns: string, key: string): Promise<string> => {
  const v = await out(ctx, `settings get ${ns} ${key}`)
  return v === '' ? 'null' : v
}
const putSetting = async (ctx: Ctx, ns: string, key: string, value: string): Promise<void> => {
  if (value === 'null') await out(ctx, `settings delete ${ns} ${key}`)
  else await out(ctx, `settings put ${ns} ${key} ${q(value)}`)
}
const isWifiAdb = (serial: string): boolean => /^[\d.]+:\d+$/.test(serial) || serial.includes('._adb-tls-connect.')

const MARK = (ok: boolean, message: string): StressResult => ({ ok, message })

async function pidsOf(ctx: Ctx): Promise<number[]> {
  const r = await out(ctx, 'ps -A -o PID,NAME')
  const pids: number[] = []
  for (const line of r.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line)
    if (m && (m[2] === ctx.pkg || m[2].startsWith(ctx.pkg + ':'))) pids.push(Number(m[1]))
  }
  return pids
}

const BUCKET_NAME: Record<string, string> = { '5': 'exempted', '10': 'active', '20': 'working_set', '30': 'frequent', '40': 'rare', '45': 'restricted', '50': 'never' }

/* ------------------------------------------------------------------ handlers */

interface Handler {
  /** Read what will be changed so it can be put back (only for items that change state). */
  capture?: (ctx: Ctx) => Promise<Orig>
  apply: (ctx: Ctx, value: string) => Promise<StressResult>
  revert?: (ctx: Ctx, orig: Orig) => Promise<void>
}

const choiceLabel = (item: StressItem, value: string): string => item.choices?.find((c) => c.value === value)?.label ?? value

const HANDLERS: Record<string, Handler> = {
  'kill-return': {
    apply: async (ctx) => {
      await out(ctx, 'input keyevent KEYCODE_HOME')
      await sleep(1200)
      const before = await pidsOf(ctx)
      if (!before.length) return MARK(false, 'App chưa chạy — hãy mở app, thao tác dở một việc rồi thử lại')
      await out(ctx, `am kill ${q(ctx.pkg)}`)
      await sleep(900)
      const after = await pidsOf(ctx)
      if (after.some((p) => before.includes(p))) return MARK(false, 'Hệ điều hành không giết được tiến trình (app còn dịch vụ nền hoặc đang ở nền trước). Thử lại sau khi về màn hình chính vài giây.')
      await out(ctx, `monkey -p ${q(ctx.pkg)} -c android.intent.category.LAUNCHER 1`)
      return MARK(true, `Đã giết ${before.length} tiến trình rồi mở lại app. Quan sát: app có về đúng màn hình, còn nguyên dữ liệu đang nhập, không bị đăng xuất?`)
    }
  },
  'trim-memory': {
    apply: async (ctx, level) => {
      if (!(await pidsOf(ctx)).length) return MARK(false, 'App chưa chạy — hãy mở app trước')
      const r = await out(ctx, `am send-trim-memory --user 0 ${q(ctx.pkg)} ${level}`)
      if (/error|unknown|exception/i.test(r)) {
        if (/non-debuggable|debuggable|SecurityException|Permission/i.test(r))
          return MARK(false, 'Android chỉ cho gửi tín hiệu này tới app debug (có cờ debuggable). App này là bản release nên bị từ chối — hãy thử với bản debug/staging, hoặc dùng mục “Giết tiến trình rồi quay lại app” thay thế.')
        const lines = r.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        return MARK(false, `Máy không nhận lệnh (mức ${level}): ${lines.slice(0, 4).join(' | ')}`)
      }
      return MARK(true, `Đã báo mức ${level} cho app. Xem Logcat / tab Hiệu năng: app có giải phóng bộ nhớ và vẫn dùng được không?`)
    }
  },
  'kill-all-bg': {
    apply: async (ctx) => {
      await out(ctx, 'am kill-all')
      return MARK(true, 'Đã giết mọi tiến trình nền. Quay lại app xem nó khôi phục có đúng không.')
    }
  },
  'dont-keep': {
    capture: async (ctx) => ({ v: await getSetting(ctx, 'global', 'always_finish_activities') }),
    apply: async (ctx, v) => {
      await putSetting(ctx, 'global', 'always_finish_activities', v === 'on' ? '1' : '0')
      return MARK(true, v === 'on' ? 'Đã bật. Giờ chuyển giữa các màn hình rồi quay lại: màn hình nào mất dữ liệu là chưa lưu trạng thái.' : 'Đã tắt')
    },
    revert: async (ctx, o) => putSetting(ctx, 'global', 'always_finish_activities', o.v)
  },
  doze: {
    apply: async (ctx, v) => {
      if (v === 'on') {
        await out(ctx, 'dumpsys battery unplug')
        const r = await out(ctx, 'dumpsys deviceidle force-idle')
        if (/unknown|error|not/i.test(r) && !/forced/i.test(r)) return MARK(false, `Máy không vào được Doze: ${r.split('\n')[0]}`)
        return MARK(true, 'Máy đang ở Doze sâu (giả vờ rút sạc). Thử gửi thông báo / đồng bộ nền, rồi bấm Khôi phục.')
      }
      await out(ctx, 'dumpsys deviceidle unforce')
      await out(ctx, 'dumpsys battery reset')
      return MARK(true, 'Đã thoát Doze')
    },
    revert: async (ctx) => {
      await out(ctx, 'dumpsys deviceidle unforce')
      await out(ctx, 'dumpsys battery reset')
    }
  },
  'standby-bucket': {
    capture: async (ctx) => ({ v: (await out(ctx, `am get-standby-bucket ${q(ctx.pkg)}`)).trim() }),
    apply: async (ctx, bucket) => {
      const r = await out(ctx, `am set-standby-bucket ${q(ctx.pkg)} ${bucket}`)
      if (/error|exception|unknown/i.test(r)) return MARK(false, `Máy không đổi được nhóm: ${r.split('\n')[0]}`)
      return MARK(true, `Đã chuyển app sang nhóm “${bucket}”. Tác vụ nền và thông báo sẽ bị giới hạn theo nhóm này.`)
    },
    revert: async (ctx, o) => {
      const name = BUCKET_NAME[o.v] ?? (/^[a-z_]+$/.test(o.v) ? o.v : 'active')
      await out(ctx, `am set-standby-bucket ${q(ctx.pkg)} ${name === 'exempted' || name === 'never' ? 'active' : name}`)
    }
  },
  'bg-restrict': {
    apply: async (ctx, v) => {
      await out(ctx, `cmd appops set ${q(ctx.pkg)} RUN_ANY_IN_BACKGROUND ${v === 'on' ? 'deny' : 'default'}`)
      return MARK(true, v === 'on' ? 'Đã cấm app chạy nền. Đưa app ra nền một lúc rồi xem dịch vụ nền có bị dừng.' : 'Đã bỏ cấm')
    },
    revert: async (ctx) => {
      await out(ctx, `cmd appops set ${q(ctx.pkg)} RUN_ANY_IN_BACKGROUND default`)
    }
  },
  'battery-level': {
    apply: async (ctx, level) => {
      await out(ctx, 'dumpsys battery unplug')
      await out(ctx, `dumpsys battery set level ${Number(level)}`)
      return MARK(true, `Máy báo pin ${level}% (giả, không rút sạc thật). Bấm Khôi phục để trả pin thật.`)
    },
    revert: async (ctx) => {
      await out(ctx, 'dumpsys battery reset')
    }
  },
  'battery-saver': {
    capture: async (ctx) => ({ v: await getSetting(ctx, 'global', 'low_power') }),
    apply: async (ctx, v) => {
      await putSetting(ctx, 'global', 'low_power', v === 'on' ? '1' : '0')
      return MARK(true, v === 'on' ? 'Đã bật tiết kiệm pin' : 'Đã tắt tiết kiệm pin')
    },
    revert: async (ctx, o) => putSetting(ctx, 'global', 'low_power', o.v)
  },
  rotation: {
    capture: async (ctx) => ({ auto: await getSetting(ctx, 'system', 'accelerometer_rotation'), user: await getSetting(ctx, 'system', 'user_rotation') }),
    apply: async (ctx, rot) => {
      await putSetting(ctx, 'system', 'accelerometer_rotation', '0')
      await putSetting(ctx, 'system', 'user_rotation', rot)
      return MARK(true, 'Đã khóa hướng màn hình. Xoay lại và xem app có tạo lại màn hình đúng không.')
    },
    revert: async (ctx, o) => {
      await putSetting(ctx, 'system', 'user_rotation', o.user)
      await putSetting(ctx, 'system', 'accelerometer_rotation', o.auto)
    }
  },
  animations: {
    capture: async (ctx) => ({
      w: await getSetting(ctx, 'global', 'window_animation_scale'),
      t: await getSetting(ctx, 'global', 'transition_animation_scale'),
      a: await getSetting(ctx, 'global', 'animator_duration_scale')
    }),
    apply: async (ctx, v) => {
      const val = v === 'on' ? '0' : '1'
      for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) await putSetting(ctx, 'global', k, val)
      return MARK(true, v === 'on' ? 'Đã tắt hiệu ứng chuyển động' : 'Đã bật lại hiệu ứng')
    },
    revert: async (ctx, o) => {
      await putSetting(ctx, 'global', 'window_animation_scale', o.w)
      await putSetting(ctx, 'global', 'transition_animation_scale', o.t)
      await putSetting(ctx, 'global', 'animator_duration_scale', o.a)
    }
  },
  touches: {
    capture: async (ctx) => ({ v: await getSetting(ctx, 'system', 'show_touches') }),
    apply: async (ctx, v) => {
      await putSetting(ctx, 'system', 'show_touches', v === 'on' ? '1' : '0')
      return MARK(true, v === 'on' ? 'Đã bật hiện điểm chạm' : 'Đã tắt hiện điểm chạm')
    },
    revert: async (ctx, o) => putSetting(ctx, 'system', 'show_touches', o.v)
  },
  'app-locale': {
    apply: async (ctx, tag) => {
      if (ctx.sdk < 33) return MARK(false, `Máy chạy Android ${ctx.sdk ? `(API ${ctx.sdk})` : ''} — đổi ngôn ngữ riêng cho app cần Android 13 trở lên. Dùng nút “Mở cài đặt ngôn ngữ của máy”.`)
      const r = await out(ctx, `cmd locale set-app-locales ${q(ctx.pkg)} --user 0 --locales ${q(tag)}`)
      if (/error|exception|unknown/i.test(r)) return MARK(false, `Máy không đổi được: ${r.split('\n')[0]}`)
      return MARK(true, `Đã đổi ngôn ngữ của app sang ${tag}. Mở các màn hình chính: chữ có bị cắt, tràn, hay còn sót tiếng cũ?`)
    },
    revert: async (ctx) => {
      await out(ctx, `cmd locale set-app-locales ${q(ctx.pkg)} --user 0`)
    }
  },
  'open-locale': {
    apply: async (ctx) => {
      await out(ctx, 'am start -a android.settings.LOCALE_SETTINGS')
      return MARK(true, 'Đã mở trang ngôn ngữ trên điện thoại')
    }
  },
  timezone: {
    capture: async (ctx) => ({ v: await out(ctx, 'getprop persist.sys.timezone') }),
    apply: async (ctx, tz) => {
      await out(ctx, `service call alarm 3 s16 ${q(tz)}`)
      await sleep(600)
      const now = await out(ctx, 'getprop persist.sys.timezone')
      if (now !== tz) return MARK(false, 'Máy không cho đổi múi giờ qua adb (hãng này chặn). Đổi tay trong Cài đặt.')
      return MARK(true, `Múi giờ máy giờ là ${tz}. Kiểm tra giờ hiển thị, lịch, và các phép tính theo ngày.`)
    },
    revert: async (ctx, o) => {
      if (o.v) await out(ctx, `service call alarm 3 s16 ${q(o.v)}`)
    }
  },
  clock: {
    capture: async (ctx) => {
      const epoch = Number((await out(ctx, 'date +%s')).split('\n').pop())
      return { auto: await getSetting(ctx, 'global', 'auto_time'), epochMs: String(epoch * 1000), at: String(Date.now()) }
    },
    apply: async (ctx, delta) => {
      const before = Number((await out(ctx, 'date +%s')).split('\n').pop()) * 1000
      const prevAuto = await getSetting(ctx, 'global', 'auto_time')
      await putSetting(ctx, 'global', 'auto_time', '0')
      await out(ctx, `service call alarm 2 i64 ${before + Number(delta)}`)
      await sleep(600)
      const after = Number((await out(ctx, 'date +%s')).split('\n').pop()) * 1000
      if (Math.abs(after - before - Number(delta)) > Math.abs(Number(delta)) / 2) {
        await putSetting(ctx, 'global', 'auto_time', prevAuto)
        return MARK(false, 'Máy không cho đổi đồng hồ qua adb (cần quyền hệ thống). Thiết lập giờ tự động đã được trả về như cũ.')
      }
      return MARK(true, 'Đã đổi giờ máy. Nhớ bấm Khôi phục để trả giờ đúng — nếu để lâu, đăng nhập và chứng chỉ có thể lỗi.')
    },
    revert: async (ctx, o) => {
      // Put the real time back (original + time elapsed on this PC), then hand control back to the network.
      const back = Number(o.epochMs) + (Date.now() - Number(o.at))
      await out(ctx, `service call alarm 2 i64 ${back}`)
      await putSetting(ctx, 'global', 'auto_time', o.auto === 'null' ? '1' : o.auto)
    }
  },
  airplane: {
    capture: async (ctx) => ({ v: await getSetting(ctx, 'global', 'airplane_mode_on') }),
    apply: async (ctx, v) => {
      if (isWifiAdb(ctx.serial)) return MARK(false, 'Đang nối adb qua Wi-Fi — bật chế độ máy bay sẽ mất kết nối. Hãy cắm cáp USB.')
      const on = v === 'on'
      if (ctx.sdk >= 30) await out(ctx, `cmd connectivity airplane-mode ${on ? 'enable' : 'disable'}`)
      else {
        await putSetting(ctx, 'global', 'airplane_mode_on', on ? '1' : '0')
        await out(ctx, `am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ${on}`)
      }
      return MARK(true, on ? 'Đã bật chế độ máy bay' : 'Đã tắt chế độ máy bay')
    },
    revert: async (ctx, o) => {
      if (isWifiAdb(ctx.serial)) return
      if (ctx.sdk >= 30) await out(ctx, `cmd connectivity airplane-mode ${o.v === '1' ? 'enable' : 'disable'}`)
      else {
        await putSetting(ctx, 'global', 'airplane_mode_on', o.v)
        await out(ctx, `am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ${o.v === '1'}`)
      }
    }
  },
  'fill-storage': {
    apply: async (ctx, leaveMb) => {
      const keep = Math.max(100, Number(leaveMb))
      const free = await freeMb(ctx)
      if (free < 0) return MARK(false, 'Không đọc được dung lượng trống của máy')
      const fillMb = free - keep
      if (fillMb < 50) return MARK(false, `Máy chỉ còn ${free} MB trống — đã ít hơn mức ${keep} MB nên không cần làm đầy thêm`)
      if (fillMb > 40 * 1024) return MARK(false, `Cần tạo tệp ${(fillMb / 1024).toFixed(0)} GB — quá lớn. Chọn mức còn trống cao hơn.`)
      await out(ctx, 'mkdir -p /sdcard/.adbkit-fill')
      const r = await out(ctx, `fallocate -l ${fillMb}M /sdcard/.adbkit-fill/fill.bin`, 10 * 60_000)
      const left = await freeMb(ctx)
      if (left < 0 || left > keep + Math.max(150, fillMb * 0.05)) {
        await out(ctx, 'rm -rf /sdcard/.adbkit-fill')
        return MARK(false, `Không tạo được tệp lớn${r ? `: ${r.split('\n')[0]}` : ''}. Máy này không hỗ trợ lệnh fallocate.`)
      }
      return MARK(true, `Máy còn ${left} MB trống. Thử tải tệp, quay video, lưu dữ liệu… rồi bấm Khôi phục để xóa tệp.`)
    },
    revert: async (ctx) => {
      await out(ctx, 'rm -rf /sdcard/.adbkit-fill')
    }
  }
}

async function freeMb(ctx: Ctx): Promise<number> {
  const r = await out(ctx, 'df -k /data')
  const line = r.split(/\r?\n/).filter((l) => /\d/.test(l)).pop() ?? ''
  const cols = line.trim().split(/\s+/)
  // Filesystem 1K-blocks Used Available Use% Mounted on
  const avail = Number(cols[3])
  return Number.isFinite(avail) ? Math.round(avail / 1024) : -1
}

/* ------------------------------------------------------------------ API */

export class Stress {
  constructor(private readonly store: StressStore) {}

  private async ctx(serial: string, pkg: string): Promise<Ctx> {
    const sdk = Number(await out({ serial, pkg, sdk: 0 }, 'getprop ro.build.version.sdk')) || 0
    return { serial, pkg, sdk }
  }

  async status(serial: string): Promise<StressStatus> {
    const c = await this.ctx(serial, '')
    const saved = this.store.all(serial)
    const applied: StressApplied[] = Object.entries(saved)
      .map(([id, s]) => ({ id, label: s.label, value: s.value, at: s.at }))
      .sort((a, b) => a.at - b.at)
    return { applied, sdk: c.sdk, freeMb: await freeMb(c).catch(() => -1) }
  }

  async apply(serial: string, id: string, value: string, pkg = ''): Promise<StressResult> {
    const item = STRESS_ITEMS.find((i) => i.id === id)
    const h = HANDLERS[id]
    if (!item || !h) return MARK(false, 'Mục không tồn tại')
    if (item.pkg && !pkg) return MARK(false, 'Hãy chọn app cần test trước')
    const saved = this.store.all(serial)[id]

    // Toggle switched off: undo from the recorded original (or just run the "off" path).
    if (item.kind === 'toggle' && value === 'off') {
      if (saved && h.revert) {
        await h.revert(await this.ctx(serial, saved.pkg || pkg), saved.orig)
        this.store.del(serial, id)
        return MARK(true, 'Đã tắt và trả về như cũ')
      }
      return h.apply(await this.ctx(serial, pkg), 'off')
    }

    const ctx = await this.ctx(serial, pkg)
    if (!h.revert) return h.apply(ctx, value) // one-shot action: nothing to remember

    // Remember the original the FIRST time this item is changed, even if it is changed again.
    const orig = saved?.orig ?? (h.capture ? await h.capture(ctx) : {})
    const r = await h.apply(ctx, value)
    if (r.ok) this.store.setKeepingOrig(serial, id, { label: item.label, value: item.kind === 'toggle' ? 'bật' : choiceLabel(item, value), at: Date.now(), orig, pkg: item.pkg ? pkg : '' })
    return r
  }

  /** Put one item (or every item) back the way it was. */
  async restore(serial: string, id?: string, pkg = ''): Promise<StressResult> {
    const saved = this.store.all(serial)
    const ids = id ? [id] : Object.keys(saved)
    if (!ids.length) return MARK(true, 'Không có gì cần khôi phục')
    const failed: string[] = []
    for (const k of ids) {
      const s = saved[k]
      const h = HANDLERS[k]
      if (!s || !h?.revert) continue
      try {
        await h.revert(await this.ctx(serial, s.pkg || pkg), s.orig)
        this.store.del(serial, k)
      } catch (e) {
        failed.push(`${s.label}: ${(e as Error).message}`)
      }
    }
    return failed.length ? MARK(false, `Chưa khôi phục hết: ${failed.join('; ')}`) : MARK(true, ids.length > 1 ? `Đã khôi phục ${ids.length} thay đổi` : 'Đã khôi phục')
  }
}
