import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deviceDetails } from './adb'
import { SuiteRunner } from './suite'
import { esc } from './report'
import type { ScrcpySession } from './scrcpy'
import type { CaseState, DeviceRun, MultiEvent, RunOptions, Suite } from '../shared/automation'

/**
 * Run one suite on several phones at the same time (one SuiteRunner per phone; the phone on
 * screen uses the mirror for input, the others adb input). Each phone gets its own report
 * folder and KBKT copy; a combined page shows every test case × phone.
 */
export class MultiRun {
  private runners: SuiteRunner[] = []
  private devices: DeviceRun[] = []
  private timer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(
    private readonly serials: string[],
    private readonly suite: Suite,
    private readonly opts: RunOptions,
    private readonly getSession: () => ScrcpySession | null,
    private readonly emit: (e: MultiEvent) => void,
    private readonly reportsRoot: string,
    private readonly templatesDir: string
  ) {}

  stop(): void {
    this.runners.forEach((r) => r.stop())
  }

  async run(): Promise<void> {
    const details = await Promise.all(this.serials.map((s) => deviceDetails(s).catch(() => null)))
    this.devices = this.serials.map((serial, i) => ({
      serial,
      model: details[i] ? `${details[i]!.model} (Android ${details[i]!.android})` : serial,
      cases: [],
      states: [],
      reports: [],
      messages: [],
      done: false,
      passed: 0,
      failed: 0
    }))
    this.timer = setInterval(() => {
      if (!this.dirty) return
      this.dirty = false
      this.emit({ kind: 'progress', devices: this.snapshot() })
    }, 500)
    this.runners = this.serials.map((serial, i) => {
      const d = this.devices[i]
      // Tag folders with the model + serial tail: two phones of the same model stay apart.
      const tag = `${details[i]?.model ?? 'may'}_${serial.slice(-4)}`
      return new SuiteRunner(
        serial,
        this.suite,
        this.opts,
        this.getSession,
        (ev) => {
          this.dirty = true
          if (ev.kind === 'start') {
            d.cases = ev.cases.map((c) => c.title)
            d.states = ev.cases.map((): CaseState => 'pending')
            d.reports = ev.cases.map(() => undefined)
            d.messages = ev.cases.map(() => '')
          } else if (ev.kind === 'case') {
            d.states[ev.index] = ev.state
            if (ev.report) d.reports[ev.index] = ev.report
            if (ev.message) d.messages[ev.index] = ev.message
          } else if (ev.kind === 'end') {
            d.done = true
            d.passed = ev.passed
            d.failed = ev.failed
            d.html = ev.html || undefined
            d.error = ev.error
          }
        },
        this.reportsRoot,
        this.templatesDir,
        tag
      )
    })
    try {
      await Promise.all(this.runners.map((r, i) => r.run().catch((e: Error) => {
        const d = this.devices[i]
        d.done = true
        d.error = e.message
      })))
    } finally {
      if (this.timer) clearInterval(this.timer)
    }
    const html = this.writeMatrix()
    this.emit({ kind: 'done', devices: this.snapshot(), html })
  }

  private snapshot(): DeviceRun[] {
    return this.devices.map((d) => ({ ...d, states: [...d.states], reports: [...d.reports], messages: [...d.messages] }))
  }

  /** tong-hop.html: rows = test cases, columns = phones, each cell links to that run's report. */
  private writeMatrix(): string {
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dir = join(this.reportsRoot, `${stamp}_NHIEU-MAY_${this.suite.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'suite'}`)
    mkdirSync(dir, { recursive: true })
    const titles = this.devices.reduce<string[]>((a, d) => (d.cases.length > a.length ? d.cases : a), [])
    const label: Record<CaseState, [string, string]> = {
      pending: ['—', '#8a8f98'],
      running: ['…', '#5b6475'],
      passed: ['ĐẠT', '#1f9d55'],
      failed: ['LỖI', '#d64545'],
      crashed: ['CRASH', '#b3261e'],
      stopped: ['DỪNG', '#8a8f98']
    }
    const href = (p?: string): string => (p ? `file:///${p.replace(/\\/g, '/')}` : '')
    const cell = (d: DeviceRun, i: number): string => {
      const s = d.states[i] ?? 'pending'
      const [t, c] = label[s]
      const body = `<b style="color:${c}">${t}</b>${d.messages[i] && s !== 'passed' ? `<div class="m">${esc(d.messages[i].slice(0, 140))}</div>` : ''}`
      return `<td>${d.reports[i] ? `<a href="${href(d.reports[i])}">${body}</a>` : body}</td>`
    }
    // Cases that pass on some phones and fail on others are the interesting ones.
    const differs = (i: number): boolean => new Set(this.devices.map((d) => d.states[i] === 'passed')).size > 1
    const rows = titles
      .map((t, i) => `<tr class="${differs(i) ? 'diff' : ''}"><th>${i + 1}. ${esc(t)}${differs(i) ? ' <span class="tag">khác nhau giữa các máy</span>' : ''}</th>${this.devices.map((d) => cell(d, i)).join('')}</tr>`)
      .join('')
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(this.suite.name)} — nhiều máy</title>
<style>body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1c2330}main{max-width:1300px;margin:0 auto;padding:24px}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3e6eb;border-radius:10px;overflow:hidden}th,td{padding:7px 10px;border-bottom:1px solid #eef0f3;text-align:left;vertical-align:top}
thead th{background:#fafbfc;font-weight:600}tbody th{font-weight:500;width:38%}.m{font-size:12px;color:#6b7280}a{text-decoration:none;color:inherit}a:hover b{text-decoration:underline}
tr.diff{background:#fff8e6}.tag{font-size:11px;background:#f2b84b33;color:#8a5a00;border-radius:8px;padding:1px 7px;margin-left:6px}.sum{display:flex;gap:12px;margin:12px 0 18px}.card{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:10px 14px}</style></head>
<body><main><h1 style="margin:0">${esc(this.suite.name)}</h1><div style="color:#6b7280">Chạy trên ${this.devices.length} máy · ${new Date().toLocaleString('vi-VN')}</div>
<div class="sum">${this.devices
      .map((d) => `<div class="card"><b>${esc(d.model)}</b><div>${d.passed} đạt · ${d.failed} lỗi / ${d.cases.length}${d.error ? ` · <span style="color:#d64545">${esc(d.error)}</span>` : ''}</div>${d.html ? `<a href="${href(d.html)}" style="color:#2f6feb">báo cáo của máy này</a>` : ''}</div>`)
      .join('')}</div>
<table><thead><tr><th>Testcase</th>${this.devices.map((d) => `<th>${esc(d.model)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
</main></body></html>`
    const file = join(dir, 'tong-hop.html')
    writeFileSync(file, html)
    return file
  }
}
