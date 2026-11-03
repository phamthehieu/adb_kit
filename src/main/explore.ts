import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { adbBinary, deviceDetails, q, shell } from './adb'
import { foregroundPackage } from './services'
import { dumpUi } from './ui'
import { esc } from './report'
import { CrashWatcher, type Crash } from './runner'
import { lintUi } from '../shared/uiLint'
import type { UiNode } from '../shared/automation'

/**
 * "Tự khám phá app": walks an app without a script — taps every untried button on each screen,
 * scrolls once, goes back — and builds a map of the screens it reached (with screenshots and
 * UI-check findings) plus every crash / ANR with the taps that led to it. Dangerous buttons
 * (log out, delete, pay, transfer, call…) are never tapped.
 */

export interface ExploreOptions {
  minutes: number
  maxActions: number
  /** Extra words (comma separated) whose buttons must never be tapped. */
  avoid: string
}

export interface ExploreProgress {
  screens: number
  actions: number
  crashes: number
  issues: number
  elapsed: number
  current: string
  done: boolean
  html?: string
  error?: string
}

interface Screen {
  id: number
  sig: string
  title: string
  activity: string
  shot: string
  issues: { title: string; level: string }[]
  tried: Set<string>
  scrolled: boolean
  out: { label: string; to: number }[]
}

interface Found {
  type: string
  summary: string
  lines: string[]
  steps: string[]
  shot?: string
  screen?: number
}

const DANGER =
  /đăng\s*xuất|logout|log\s*out|sign\s*out|thoát tài khoản|xóa|xoá|delete|remove|gỡ|uninstall|thanh\s*toán|pay\b|payment|mua\b|buy|đặt\s*(hàng|mua|xe|lịch)|order|chuyển\s*(tiền|khoản)|transfer|nạp\s*(tiền|thẻ)|top\s*up|rút\s*tiền|withdraw|gọi\b|call\b|hủy\s*(tài khoản|dịch vụ|gói|đơn)|huỷ\s*(tài khoản|dịch vụ|gói|đơn)|khóa tài khoản|reset|đặt lại|báo cáo vi phạm|report|chặn|block|đăng ký gói|xác nhận thanh toán|gửi tiền/i
const PERMISSION_UI = /permissioncontroller|packageinstaller/

/** Stable identity of a screen: ids + static texts (numbers stripped), not positions. */
function signature(nodes: UiNode[]): string {
  const parts = nodes
    .filter((n) => n.id || n.text || n.desc)
    .map((n) => `${n.cls}|${n.id.split('/').pop() ?? ''}|${(n.text || n.desc).replace(/\d+/g, '#').slice(0, 40)}`)
  const uniq = [...new Set(parts)].sort()
  let h = 2166136261
  for (const c of uniq.join('\n')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return h.toString(36)
}

export class Explorer {
  private stopped = false
  private screens = new Map<string, Screen>()
  private found: Found[] = []
  private actions = 0
  private trail: string[] = []
  private pendingCrash: Crash | null = null
  private started = 0
  readonly dir: string
  private avoid: RegExp | null

  constructor(
    private readonly serial: string,
    private readonly pkg: string,
    private readonly opts: ExploreOptions,
    private readonly emit: (p: ExploreProgress) => void,
    reportsRoot: string
  ) {
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    this.dir = join(reportsRoot, `${stamp}_KHAM-PHA_${pkg.split('.').pop()}`)
    const extra = opts.avoid
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    this.avoid = extra.length ? new RegExp(extra.join('|'), 'i') : null
  }

  stop(): void {
    this.stopped = true
  }

  private progress(current: string, extra: Partial<ExploreProgress> = {}): void {
    this.emit({
      screens: this.screens.size,
      actions: this.actions,
      crashes: this.found.length,
      issues: [...this.screens.values()].reduce((n, s) => n + s.issues.length, 0),
      elapsed: Date.now() - this.started,
      current,
      done: false,
      ...extra
    })
  }

  private wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  /** Lock screen showing (the app behind it still reports as "foreground"). */
  private async locked(): Promise<boolean> {
    const r = await shell(this.serial, "dumpsys window | grep -E 'isStatusBarKeyguard|mShowingLockscreen|KeyguardShowing|mDreamingLockscreen'")
    return /(isStatusBarKeyguard|mShowingLockscreen|mKeyguardShowing|KeyguardShowing|mDreamingLockscreen)=true/.test(r.stdout)
  }

  private async launch(): Promise<void> {
    await shell(this.serial, `monkey -p ${q(this.pkg)} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`)
    this.trail = ['Mở app']
    await this.wait(3000)
  }

  private async shot(name: string): Promise<string | undefined> {
    try {
      writeFileSync(join(this.dir, name), await adbBinary(['-s', this.serial, 'exec-out', 'screencap', '-p']))
      return name
    } catch {
      return undefined
    }
  }

  async run(): Promise<string> {
    mkdirSync(this.dir, { recursive: true })
    this.started = Date.now()
    const watcher = new CrashWatcher(this.serial, (c) => {
      if (c.pkg === this.pkg) this.pendingCrash = c
    })
    const densOut = (await shell(this.serial, 'wm density')).stdout
    const density = Number(/Override density:\s*(\d+)/.exec(densOut)?.[1] ?? /Physical density:\s*(\d+)/.exec(densOut)?.[1] ?? 420)
    let error: string | undefined
    try {
      if (await this.locked()) throw new Error('Điện thoại đang khóa màn hình — mở khóa (và tắt khóa tự động nếu chạy lâu) rồi bấm lại.')
      await this.launch()
      let prev: Screen | null = null
      let lastLabel = ''
      let stuck = 0
      while (!this.stopped && Date.now() - this.started < this.opts.minutes * 60_000 && this.actions < this.opts.maxActions) {
        if (this.pendingCrash) {
          await this.recordCrash(this.pendingCrash, prev)
          this.pendingCrash = null
          await this.launch()
          prev = null
          continue
        }
        if (await this.locked()) {
          error = 'Điện thoại đã tự khóa màn hình giữa chừng — đã dừng. Tăng "Thời gian tắt màn hình" hoặc bật "Không khóa khi sạc" rồi chạy lại.'
          break
        }
        const fg = await foregroundPackage(this.serial).catch(() => null)
        if (fg !== this.pkg) {
          // System permission prompt: allow it and carry on; anything else: come back.
          if (fg && PERMISSION_UI.test(fg)) {
            await this.tapText(/cho phép|allow|while using|khi dùng/i)
            continue
          }
          if (++stuck > 3) {
            await this.launch()
            stuck = 0
          } else await shell(this.serial, 'input keyevent 4')
          await this.wait(1200)
          continue
        }
        stuck = 0
        let dump: Awaited<ReturnType<typeof dumpUi>>
        try {
          dump = await dumpUi(this.serial)
        } catch {
          await this.wait(1000)
          continue
        }
        const nodes = dump.nodes.filter((n) => n.pkg === this.pkg)
        const sig = signature(nodes)
        let screen = this.screens.get(sig)
        if (!screen) {
          const id = this.screens.size + 1
          const act = /\{\S+ u\d+ \S+\/(\S+)/.exec((await shell(this.serial, 'dumpsys activity activities | grep -m1 -E "mResumedActivity|topResumedActivity"')).stdout)?.[1] ?? ''
          const big = [...nodes].filter((n) => n.text.trim()).sort((a, b) => a.b[1] - b.b[1])[0]
          screen = {
            id,
            sig,
            title: (big?.text ?? act.split('.').pop() ?? `Màn ${id}`).slice(0, 60),
            activity: act.replace(/^\./, ''),
            shot: (await this.shot(`man-${String(id).padStart(3, '0')}.png`)) ?? '',
            issues: lintUi({ nodes: dump.nodes, width: dump.width, height: dump.height, density }).map((x) => ({ title: x.title, level: x.level })),
            tried: new Set(),
            scrolled: false,
            out: []
          }
          this.screens.set(sig, screen)
        }
        if (prev && prev !== screen && lastLabel && !prev.out.some((o) => o.label === lastLabel && o.to === screen!.id)) prev.out.push({ label: lastLabel, to: screen.id })
        prev = screen

        const target = this.pick(nodes, screen, dump.nodes)
        if (target) {
          screen.tried.add(target.key)
          lastLabel = target.label
          this.progress(`Màn ${screen.id}: bấm “${target.label}”`)
          await shell(this.serial, `input tap ${Math.round(target.x * dump.width)} ${Math.round(target.y * dump.height)}`)
          this.trail.push(`Bấm “${target.label}”`)
        } else if (!screen.scrolled) {
          screen.scrolled = true
          lastLabel = 'cuộn xuống'
          this.progress(`Màn ${screen.id}: cuộn xuống`)
          const [w, h] = [dump.width, dump.height]
          await shell(this.serial, `input swipe ${Math.round(w / 2)} ${Math.round(h * 0.75)} ${Math.round(w / 2)} ${Math.round(h * 0.3)} 300`)
          this.trail.push('Cuộn xuống')
        } else {
          lastLabel = 'Back'
          this.progress(`Màn ${screen.id}: đã thử hết, quay lại`)
          await shell(this.serial, 'input keyevent 4')
          this.trail.push('Bấm Back')
        }
        this.actions++
        await this.wait(1500)
      }
      if (this.pendingCrash) await this.recordCrash(this.pendingCrash, prev)
    } catch (e) {
      error = (e as Error).message
    } finally {
      watcher.stop()
    }
    const html = await this.writeReport(error)
    this.progress('Xong', { done: true, html, error })
    return html
  }

  /** Next untried, safe, clickable element on this screen (top to bottom). */
  private pick(nodes: UiNode[], screen: Screen, all: UiNode[]): { key: string; label: string; x: number; y: number } | null {
    const idx = new Map(all.map((n, i) => [n, i]))
    const childText = (n: UiNode): string => {
      const i = idx.get(n)!
      for (let k = i + 1; k < all.length && k < i + 30; k++) {
        let p = all[k].parent ?? -1
        while (p >= 0 && p !== i) p = all[p].parent ?? -1
        if (p === i && (all[k].text || all[k].desc)) return all[k].text || all[k].desc
      }
      return ''
    }
    const cands = nodes
      .filter((n) => n.clickable && n.enabled !== false && !/EditText/.test(n.cls))
      .filter((n) => (n.b[2] - n.b[0]) * (n.b[3] - n.b[1]) < 0.6 && n.b[3] > 0.04 && n.b[1] < 0.98)
      .map((n) => {
        const label = (n.text || n.desc || childText(n) || n.id.split('/').pop() || n.cls).trim().slice(0, 50)
        const x = (n.b[0] + n.b[2]) / 2
        const y = (n.b[1] + n.b[3]) / 2
        return { key: label ? `${label}@${Math.round(y * 20)}` : `${n.cls}@${x.toFixed(2)},${y.toFixed(2)}`, label: label || 'phần tử không tên', x, y }
      })
      .filter((c) => !DANGER.test(c.label) && !(this.avoid && this.avoid.test(c.label)))
      .sort((a, b) => a.y - b.y || a.x - b.x)
    return cands.find((c) => !screen.tried.has(c.key)) ?? null
  }

  private async tapText(re: RegExp): Promise<void> {
    try {
      const d = await dumpUi(this.serial)
      const n = d.nodes.find((x) => x.clickable && re.test(x.text || x.desc))
      if (n) await shell(this.serial, `input tap ${Math.round(((n.b[0] + n.b[2]) / 2) * d.width)} ${Math.round(((n.b[1] + n.b[3]) / 2) * d.height)}`)
      else await shell(this.serial, 'input keyevent 4')
    } catch {
      await shell(this.serial, 'input keyevent 4')
    }
    await this.wait(1200)
  }

  private async recordCrash(c: Crash, at: Screen | null): Promise<void> {
    const n = this.found.length + 1
    const shot = await this.shot(`crash-${n}.png`)
    this.found.push({ type: c.type, summary: c.summary, lines: c.lines, steps: [...this.trail], shot, screen: at?.id })
    this.progress(`${c.type.toUpperCase()}: ${c.summary}`)
  }

  private async writeReport(error?: string): Promise<string> {
    const d = await deviceDetails(this.serial).catch(() => null)
    const screens = [...this.screens.values()]
    const incoming = (id: number): string[] => screens.flatMap((s) => s.out.filter((o) => o.to === id).map((o) => `${s.id}. ${s.title} › “${o.label}”`))
    const totalIssues = screens.reduce((n, s) => n + s.issues.length, 0)
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Khám phá ${esc(this.pkg)}</title>
<style>body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1c2330}main{max-width:1300px;margin:0 auto;padding:24px}h2{font-size:16px;margin:26px 0 10px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:10px 16px}.card b{font-size:22px;display:block}.muted{color:#6b7280}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}.sc{background:#fff;border:1px solid #e3e6eb;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.sc img{width:100%;aspect-ratio:9/18;object-fit:cover;object-position:top;background:#000}.sc .b{padding:8px 10px;font-size:12.5px}.sc .t{font-weight:600}.sc ul{margin:4px 0 0;padding-left:16px}
.bad{color:#d64545}.warn{color:#b7791f}.crash{background:#fff;border:1px solid #f5c2c2;border-radius:10px;padding:12px 16px;margin-bottom:12px;display:flex;gap:16px}.crash img{width:160px;border-radius:8px}
.crash pre{background:#0f1216;color:#ffb4b4;padding:10px;border-radius:8px;font-size:11.5px;overflow:auto;max-height:220px;white-space:pre-wrap}ol{margin:4px 0;padding-left:20px}</style></head>
<body><main><h1 style="margin:0">Tự khám phá: ${esc(this.pkg)}</h1>
<div class="muted">${d ? esc(`${d.manufacturer} ${d.model}, Android ${d.android}`) : esc(this.serial)} · ${new Date(this.started).toLocaleString('vi-VN')} · ${Math.round((Date.now() - this.started) / 1000)} giây${error ? ` · <span class="bad">${esc(error)}</span>` : ''}</div>
<div class="cards"><div class="card"><span class="muted">Màn hình tìm thấy</span><b>${screens.length}</b></div><div class="card"><span class="muted">Thao tác</span><b>${this.actions}</b></div>
<div class="card"><span class="muted">Crash / ANR</span><b class="${this.found.length ? 'bad' : ''}">${this.found.length}</b></div><div class="card"><span class="muted">Vấn đề giao diện</span><b class="${totalIssues ? 'warn' : ''}">${totalIssues}</b></div></div>
${
      this.found.length
        ? `<h2 class="bad">Crash / ANR (${this.found.length})</h2>${this.found
            .map(
              (f) => `<div class="crash">${f.shot ? `<img src="${f.shot}">` : ''}<div style="flex:1;min-width:0"><b class="bad">${esc(f.type.toUpperCase())}: ${esc(f.summary)}</b>
<div class="muted">Các bước tái hiện (từ lúc mở app):</div><ol>${f.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><pre>${esc(f.lines.slice(0, 40).join('\n'))}</pre></div></div>`
            )
            .join('')}`
        : ''
    }
<h2>Các màn hình (${screens.length})</h2><div class="grid">${screens
      .map(
        (s) => `<div class="sc">${s.shot ? `<a href="${s.shot}"><img src="${s.shot}" loading="lazy"></a>` : ''}<div class="b"><div class="t">${s.id}. ${esc(s.title)}</div><div class="muted">${esc(s.activity.split('.').pop() ?? '')}</div>
${incoming(s.id).length ? `<div class="muted" style="margin-top:4px">Đến từ: ${incoming(s.id).slice(0, 3).map(esc).join('; ')}</div>` : ''}
${s.out.length ? `<div style="margin-top:4px">Dẫn tới: ${s.out.slice(0, 6).map((o) => `“${esc(o.label)}” → ${o.to}`).join(', ')}</div>` : ''}
${s.issues.length ? `<ul>${s.issues.slice(0, 4).map((i) => `<li class="${i.level === 'bad' ? 'bad' : 'warn'}">${esc(i.title)}</li>`).join('')}${s.issues.length > 4 ? `<li class="muted">+${s.issues.length - 4} vấn đề khác</li>` : ''}</ul>` : ''}</div></div>`
      )
      .join('')}</div>
<p class="muted">Bỏ qua các nút có chữ như đăng xuất, xóa, thanh toán, mua, chuyển tiền, gọi… Ô nhập chữ không được điền. Vấn đề giao diện là kiểm tra tự động (vùng bấm, nhãn, chữ đè/cắt) — xem lại bằng mắt.</p>
</main></body></html>`
    const file = join(this.dir, 'kham-pha.html')
    writeFileSync(file, html)
    return file
  }
}
