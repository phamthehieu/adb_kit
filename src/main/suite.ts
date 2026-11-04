import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { freshApp } from './freshapp'
import { Runner } from './runner'
import { writeBack, writeKbkt, type KbktCase, type KbktResult } from './kbkt'
import type { ScrcpySession } from './scrcpy'
import {
  applyVars,
  expectedOf,
  parseCsv,
  stepsText,
  suiteFresh,
  kbktKey,
  type CaseInfo,
  type CaseState,
  type RunOptions,
  type Script,
  type Suite,
  type SuiteEvent
} from '../shared/automation'

/* ------------------------------------------------------------- suite files */

/** Read a suite file; item paths are stored relative to it and returned absolute. */
export function readSuite(path: string): Suite {
  const s = JSON.parse(readFileSync(path, 'utf8')) as Suite
  if (s.kind !== 'adbkit-suite' || !Array.isArray(s.items)) throw new Error('Không phải file bộ test của ADB Kit')
  const base = dirname(path)
  const abs = (p?: string): string | undefined => (p ? (isAbsolute(p) ? p : resolve(base, p)) : p)
  const tpl = (t?: string): string | undefined => (!t || t === 'BES' || t === 'BCCS' ? t : abs(t))
  return {
    ...s,
    template: tpl(s.template),
    items: s.items.map((it) => ({ ...it, path: abs(it.path)!, data: abs(it.data) })),
    kbkt: s.kbkt && { ...s.kbkt, file: abs(s.kbkt.file)!, rows: s.kbkt.rows.map((r) => ({ ...r, script: abs(r.script) })) }
  }
}

/** Paths are stored relative to the suite file so a whole "tests" folder can be moved / shared. */
export function writeSuite(path: string, s: Suite): void {
  const base = dirname(path)
  const rel = (p?: string): string | undefined => (p ? relative(base, p).replace(/\\/g, '/') : p)
  const tpl = (t?: string): string | undefined => (!t || t === 'BES' || t === 'BCCS' ? t : rel(t))
  writeFileSync(
    path,
    JSON.stringify(
      {
        ...s,
        template: tpl(s.template),
        items: s.items.map((it) => ({ ...it, path: rel(it.path), data: rel(it.data) })),
        kbkt: s.kbkt && { ...s.kbkt, file: rel(s.kbkt.file), rows: s.kbkt.rows.map((r) => ({ ...r, script: rel(r.script) })) }
      },
      null,
      2
    )
  )
}

/** Template file for a suite: bundled BES / BCCS, or the tester's own. */
export function templateFor(s: Suite, templatesDir: string): string {
  if (!s.template || s.template === 'BES') return join(templatesDir, 'template_KBKT_BES.xlsx')
  if (s.template === 'BCCS') return join(templatesDir, 'template_KBKT_BCCS.xlsx')
  return s.template
}

/** Write the tester's manual results (and nothing else) into a copy of the imported KBKT file. */
export async function writeManualResults(s: Suite, outDir: string): Promise<{ path: string; count: number }> {
  if (!s.kbkt) throw new Error('Bộ test chưa nhập file KBKT')
  const res = s.kbkt.rows
    .filter((r) => r.manual)
    // `report` becomes the hyperlink in the KBKT cell, so the evidence is one click away from the result.
    .map((r) => ({ sheet: r.sheet, row: r.row, results: [r.manual as 'P' | 'F' | 'PE'], note: r.note ?? '', report: r.evidence }))
  mkdirSync(outDir, { recursive: true })
  const out = join(outDir, basename(s.kbkt.file))
  const count = await writeBack(s.kbkt.file, out, res)
  return { path: out, count }
}

export function readScript(path: string): Script {
  const s = JSON.parse(readFileSync(path, 'utf8')) as Script
  if (!Array.isArray(s.steps)) throw new Error(`${basename(path)} không phải kịch bản ADB Kit`)
  return s
}

/* ------------------------------------------------------------------ runner */

interface Case extends Omit<CaseInfo, 'kbkt'> {
  kbkt?: string
  script: Script
  vars?: Record<string, string>
}

interface CaseResult {
  state: CaseState
  attempts: ('P' | 'F')[]
  message: string
  report?: string
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export class SuiteRunner {
  private stopped = false
  private current: Runner | null = null
  readonly dir: string

  constructor(
    private readonly serial: string,
    private readonly suite: Suite,
    private readonly opts: RunOptions,
    private readonly getSession: () => ScrcpySession | null,
    private readonly emit: (e: SuiteEvent) => void,
    reportsRoot: string,
    private readonly templatesDir: string,
    /** Extra name part (device model) when the same suite runs on several phones at once. */
    tag?: string
  ) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safe = (s: string): string => s.replace(/[^\w-]+/g, '_').slice(0, 40)
    this.dir = join(reportsRoot, `${stamp}_BO-TEST_${safe(suite.name) || 'suite'}${tag ? `_${safe(tag)}` : ''}`)
  }

  stop(): void {
    this.stopped = true
    this.current?.stop()
  }

  /** Expand items into test cases (one per CSV row when a data file is attached). */
  private buildCases(): Case[] {
    const cases: Case[] = []
    this.suite.items.forEach((it, item) => {
      if (!it.enabled) return
      const script = readScript(it.path)
      const group = it.group?.trim() || ''
      if (it.data && existsSync(it.data)) {
        const rows = parseCsv(readFileSync(it.data, 'utf8'))
        rows.forEach((row, k) => {
          const label = Object.values(row)[0] || `dòng ${k + 1}`
          // A name that already uses ${...} identifies the row by itself; otherwise tag it.
          const name = script.name.includes('${') ? script.name : `${script.name} [${label}]`
          const applied = applyVars({ ...script, name }, row)
          cases.push({ index: cases.length, item, group, title: applied.name, script: applied, vars: row })
        })
      } else {
        cases.push({ index: cases.length, item, group, title: script.name, script })
      }
    })
    // Rows of the imported KBKT file that have a verifying script.
    for (const r of this.suite.kbkt?.rows ?? []) {
      if (!r.script) continue
      const script = readScript(r.script)
      cases.push({
        index: cases.length,
        item: -1,
        group: `KBKT · ${r.sheet}${r.group ? ` › ${r.group}` : ''}`,
        title: `${r.code ? `${r.code} — ` : ''}${r.purpose || script.name}`,
        script,
        kbkt: kbktKey(r)
      })
    }
    return cases
  }

  async run(): Promise<void> {
    let cases: Case[]
    try {
      cases = this.buildCases()
    } catch (e) {
      this.emit({ kind: 'end', passed: 0, failed: 0, total: 0, stopped: false, html: '', error: (e as Error).message })
      return
    }
    mkdirSync(this.dir, { recursive: true })
    this.emit({ kind: 'start', cases: cases.map(({ index, title, group, item, kbkt }) => ({ index, title, group, item, kbkt })), dir: this.dir })

    const results: CaseResult[] = cases.map(() => ({ state: 'pending', attempts: [], message: '' }))
    const maxAttempts = 1 + Math.max(0, Math.min(2, this.suite.retries)) // KQ lần 1..3
    const started = new Date()

    for (const c of cases) {
      if (this.stopped) break
      const res = results[c.index]
      for (let attempt = 1; attempt <= maxAttempts && !this.stopped; attempt++) {
        this.emit({ kind: 'case', index: c.index, attempt, state: 'running' })
        // Start every case (and every retry) from the app state the suite asks for.
        const fresh = suiteFresh(this.suite)
        const freshPerms = this.suite.freshPerms ?? 'keep'
        let setupError = ''
        if (c.script.app && (fresh !== 'off' || freshPerms !== 'keep')) {
          try {
            await freshApp(this.serial, c.script.app, fresh, freshPerms)
          } catch (e) {
            setupError = `Không đưa ${c.script.app} về trạng thái ban đầu: ${(e as Error).message}`
          }
        }
        if (setupError) {
          res.attempts.push('F')
          res.state = 'failed'
          res.message = setupError
          this.emit({ kind: 'case', index: c.index, attempt, state: 'failed', message: setupError })
          break // retrying cannot fix a device that refuses the reset
        }
        const dirName = `${String(c.index + 1).padStart(2, '0')}_${c.script.name.replace(/[^\w-]+/g, '_').slice(0, 40)}${attempt > 1 ? `_lan${attempt}` : ''}`
        const runner = new Runner(
          this.serial,
          c.script,
          { ...this.opts, repeat: 1, fresh: 'off', freshPerms: 'keep' }, // the suite already prepared the app
          this.getSession,
          (event) => this.emit({ kind: 'run', index: c.index, event }),
          this.dir,
          dirName
        )
        this.current = runner
        await runner.run()
        this.current = null
        const o = runner.outcome
        if (!o || o.result === 'stopped') {
          res.state = 'stopped'
          res.message = 'Đã dừng'
          this.emit({ kind: 'case', index: c.index, attempt, state: 'stopped', report: o?.report })
          break
        }
        res.attempts.push(o.result === 'passed' ? 'P' : 'F')
        res.state = o.result
        res.message = o.message
        res.report = o.report
        this.emit({ kind: 'case', index: c.index, attempt, state: o.result, message: o.message, report: o.report })
        if (o.result === 'passed') break
      }
    }

    const passed = results.filter((r) => r.state === 'passed').length
    const failed = results.filter((r) => r.state === 'failed' || r.state === 'crashed').length
    const html = this.writeSummary(cases, results, started)

    const noteOf = (r: CaseResult): string =>
      r.state === 'passed' ? (r.attempts.length > 1 ? `Đạt ở lần ${r.attempts.length}` : '') : r.state === 'pending' ? 'Chưa chạy' : r.message

    let xlsx: string | undefined
    let kbktOut: string | undefined
    const errors: string[] = []
    // 1) New KBKT generated from the suite's own scripts (in the chosen template).
    const own = cases.filter((c) => c.item >= 0)
    if (own.length) {
      try {
        const kc: KbktCase[] = own.map((c) => {
          const r = results[c.index]
          return {
            group: c.group,
            purpose: c.script.purpose?.trim() || c.script.name,
            steps: stepsText(c.script),
            data: c.vars ? Object.entries(c.vars).map(([k, v]) => `${k}=${v}`).join(', ') : undefined,
            expected: expectedOf(c.script),
            results: r.attempts,
            note: noteOf(r),
            report: r.report
          }
        })
        xlsx = join(this.dir, `KBKT_${this.suite.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'BoTest'}.xlsx`)
        await writeKbkt(templateFor(this.suite, this.templatesDir), xlsx, {
          title: this.suite.name,
          code: this.suite.code || 'TC',
          author: this.suite.author,
          tester: this.suite.tester,
          cases: kc
        })
      } catch (e) {
        xlsx = undefined
        errors.push(`Không xuất được Excel: ${(e as Error).message}`)
      }
    }
    // 2) The imported KBKT file: automated results + the tester's manual results, in a copy.
    if (this.suite.kbkt) {
      try {
        const byKey = new Map(cases.filter((c) => c.kbkt).map((c) => [c.kbkt!, c]))
        const res: KbktResult[] = []
        for (const row of this.suite.kbkt.rows) {
          const c = byKey.get(kbktKey(row))
          if (c && results[c.index].attempts.length) {
            const r = results[c.index]
            res.push({ sheet: row.sheet, row: row.row, results: r.attempts, note: noteOf(r), report: r.report })
          } else if (row.manual) {
            res.push({ sheet: row.sheet, row: row.row, results: [row.manual], note: row.note ?? 'Test tay' })
          }
        }
        kbktOut = join(this.dir, basename(this.suite.kbkt.file))
        await writeBack(this.suite.kbkt.file, kbktOut, res)
      } catch (e) {
        kbktOut = undefined
        errors.push(`Không ghi được kết quả vào file KBKT: ${(e as Error).message}`)
      }
    }
    this.emit({ kind: 'end', passed, failed, total: cases.length, stopped: this.stopped, html, xlsx, kbktOut, error: errors.join(' · ') || undefined })
  }

  private writeSummary(cases: Case[], results: CaseResult[], started: Date): string {
    const passed = results.filter((r) => r.state === 'passed').length
    const failed = results.filter((r) => r.state === 'failed' || r.state === 'crashed').length
    const notRun = cases.length - passed - failed
    const dur = ((Date.now() - started.getTime()) / 1000).toFixed(0)
    const label: Record<CaseState, string> = { pending: 'Chưa chạy', running: 'Đang chạy', passed: 'ĐẠT', failed: 'LỖI', crashed: 'CRASH', stopped: 'Đã dừng' }
    const color: Record<CaseState, string> = { pending: '#8a8f98', running: '#5b6475', passed: '#1f9d55', failed: '#d64545', crashed: '#b3261e', stopped: '#8a8f98' }
    let lastGroup = ''
    const rows = cases
      .map((c, i) => {
        const r = results[i]
        const head = c.group && c.group !== lastGroup ? `<tr class="grp"><td colspan="5">${esc(c.group)}</td></tr>` : ''
        lastGroup = c.group
        const link = r.report ? `<a href="${esc(relative(this.dir, r.report).replace(/\\/g, '/'))}">báo cáo</a>` : ''
        return `${head}<tr><td>${i + 1}</td><td>${esc(c.title)}</td><td><b style="color:${color[r.state]}">${label[r.state]}</b>${
          r.attempts.length > 1 ? ` <span class="muted">(${r.attempts.join(' → ')})</span>` : ''
        }</td><td>${esc(r.state === 'passed' ? '' : r.message)}</td><td>${link}</td></tr>`
      })
      .join('')
    const pct = cases.length ? Math.round((passed / cases.length) * 100) : 0
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(this.suite.name)} — ${passed}/${cases.length} đạt</title>
<style>
 body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1d2330}
 main{max-width:1100px;margin:0 auto;padding:28px}
 h1{margin:0 0 4px;font-size:22px}
 .muted{color:#8a8f98}
 .cards{display:flex;gap:12px;margin:18px 0}
 .card{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:14px 18px;min-width:120px}
 .card b{display:block;font-size:26px}
 .bar{height:10px;border-radius:99px;background:#f1d4d4;overflow:hidden;margin:6px 0 20px}
 .bar span{display:block;height:100%;background:#1f9d55}
 table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e6eb;border-radius:10px;overflow:hidden}
 td,th{padding:8px 10px;border-bottom:1px solid #eef0f3;text-align:left;vertical-align:top}
 th{background:#fafbfc;color:#5b6475;font-size:12px}
 tr.grp td{background:#fff6cc;font-weight:600}
</style></head><body><main>
<h1>${esc(this.suite.name)}</h1>
<div class="muted">${started.toLocaleString('vi-VN')} · ${dur} giây · Mã ${esc(this.suite.code)}${this.suite.tester ? ` · Người test: ${esc(this.suite.tester)}` : ''}${this.stopped ? ' · <b>đã dừng giữa chừng</b>' : ''}</div>
<div class="cards">
 <div class="card"><span class="muted">Tổng</span><b>${cases.length}</b></div>
 <div class="card"><span class="muted">Đạt</span><b style="color:#1f9d55">${passed}</b></div>
 <div class="card"><span class="muted">Lỗi</span><b style="color:#d64545">${failed}</b></div>
 <div class="card"><span class="muted">Chưa chạy</span><b>${notRun}</b></div>
</div>
<div class="bar"><span style="width:${pct}%"></span></div>
<table><tr><th>#</th><th>Testcase</th><th>Kết quả</th><th>Lý do</th><th></th></tr>${rows}</table>
</main></body></html>`
    const path = join(this.dir, 'tong-hop.html')
    writeFileSync(path, html)
    return path
  }
}
