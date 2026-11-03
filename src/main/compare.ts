import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { callFailed, type NetCall } from '../shared/automation'
import { esc, type ReportData } from './report'

/**
 * Compare two runs of the same script (e.g. last build vs. new build): steps that started
 * failing / were fixed / got slower, performance, API endpoints (new, gone, status or speed
 * changes), screenshots pixel by pixel, and new JavaScript errors. Writes so-sanh.html.
 */

type Rep = Omit<ReportData, 'started' | 'finished'> & { started: string; finished: string }

function load(dir: string): Rep {
  const f = join(dir, 'report.json')
  if (!existsSync(f)) throw new Error(`"${basename(dir)}" không có report.json — báo cáo được tạo trước bản ADB Kit này, hãy chạy lại kịch bản để có dữ liệu so sánh.`)
  return JSON.parse(readFileSync(f, 'utf8')) as Rep
}

/** Endpoint key: method + path with ids / numbers replaced, so /order/123 and /order/456 match. */
const endpoint = (c: NetCall): string =>
  `${c.kind === 'ipc' ? (c.source === 'bridge' ? 'BRIDGE' : 'CMD') : c.method} ${c.url
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]
    .replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')}`

interface Ep {
  n: number
  fail: number
  ms: number[]
  statuses: Set<string>
}
function endpoints(calls: NetCall[]): Map<string, Ep> {
  const m = new Map<string, Ep>()
  for (const c of calls) {
    const k = endpoint(c)
    const e = m.get(k) ?? { n: 0, fail: 0, ms: [], statuses: new Set<string>() }
    e.n++
    if (callFailed(c)) e.fail++
    if (c.durationMs !== undefined) e.ms.push(c.durationMs)
    e.statuses.add(c.status === undefined ? '…' : String(c.status || c.error || 'lỗi'))
    m.set(k, e)
  }
  return m
}
const avg = (a: number[]): number | undefined => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : undefined)
const median = (a: number[]): number | undefined => {
  if (!a.length) return undefined
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/** "+35%" style delta; `worse` decides the colour (higher = worse for times, memory…). */
function delta(a?: number, b?: number, unit = '', threshold = 0.2): string {
  if (a === undefined || b === undefined) return `<td>${a ?? '—'}${a !== undefined ? unit : ''}</td><td>${b ?? '—'}${b !== undefined ? unit : ''}</td><td></td>`
  const d = a ? (b - a) / a : 0
  const cls = Math.abs(d) < threshold ? '' : d > 0 ? 'worse' : 'better'
  return `<td>${a}${unit}</td><td>${b}${unit}</td><td class="${cls}">${d > 0 ? '+' : ''}${Math.round(d * 100)}%</td>`
}

function diffImage(fa: string, fb: string, out: string): number | null {
  try {
    const a = PNG.sync.read(readFileSync(fa))
    const b = PNG.sync.read(readFileSync(fb))
    if (a.width !== b.width || a.height !== b.height) return null
    const d = new PNG({ width: a.width, height: a.height })
    const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 })
    writeFileSync(out, PNG.sync.write(d))
    return Math.round((n / (a.width * a.height)) * 10000) / 100
  } catch {
    return null
  }
}

export function compareReports(dirA: string, dirB: string, reportsRoot: string): string {
  const A = load(dirA)
  const B = load(dirB)
  const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const out = join(reportsRoot, `${stamp}_SO-SANH_${(B.script.name || 'test').replace(/[^\w-]+/g, '_').slice(0, 40)}`)
  mkdirSync(out, { recursive: true })
  const href = (dir: string, f: string): string => `file:///${join(dir, f).replace(/\\/g, '/')}`

  /* ---- steps (last iteration of each run) */
  const lastIter = (r: Rep): number => (r.results.length ? r.results[r.results.length - 1].iteration : 0)
  const sa = A.results.filter((x) => x.iteration === lastIter(A))
  const sb = B.results.filter((x) => x.iteration === lastIter(B))
  const nSteps = Math.max(sa.length, sb.length)
  let regress = 0
  let fixed = 0
  let slower = 0
  const stepRows: string[] = []
  for (let i = 0; i < nSteps; i++) {
    const a = sa[i]
    const b = sb[i]
    const okA = a ? a.state !== 'failed' : undefined
    const okB = b ? b.state !== 'failed' : undefined
    let tag = ''
    if (okA === true && okB === false) {
      regress++
      tag = '<span class="tag bad">mới lỗi</span>'
    } else if (okA === false && okB === true) {
      fixed++
      tag = '<span class="tag good">đã hết lỗi</span>'
    }
    if (a && b && a.ms > 300 && b.ms > a.ms * 1.5) {
      slower++
      tag += ' <span class="tag warn">chậm hơn</span>'
    }
    const st = (x?: typeof a): string => (x ? `<b class="${x.state === 'failed' ? 'bad' : 'ok'}">${x.state === 'failed' ? 'LỖI' : 'đạt'}</b> <span class="muted">${(x.ms / 1000).toFixed(1)} s</span>${x.message && x.state === 'failed' ? `<div class="m">${esc(x.message)}</div>` : ''}` : '<span class="muted">—</span>')
    stepRows.push(`<tr class="${tag.includes('mới lỗi') ? 'row-bad' : tag.includes('hết lỗi') ? 'row-good' : ''}"><th>${i + 1}. ${esc((b ?? a)!.text)}</th><td>${st(a)}</td><td>${st(b)}</td><td>${tag}</td></tr>`)
  }

  /* ---- performance */
  const mem = (r: Rep): number[] => (r.perf?.samples ?? []).map((s) => s.memMb).filter((v): v is number => v !== undefined)
  const cpu = (r: Rep): number[] => (r.perf?.samples ?? []).map((s) => s.cpu).filter((v): v is number => v !== undefined)
  const startup = (r: Rep): number | undefined => median((r.perf?.startups ?? []).map((s) => s.ms))
  const perfRows = [
    ['Thời gian mở app (ms)', startup(A), startup(B), ' ms'],
    ['RAM cao nhất (MB)', mem(A).length ? Math.max(...mem(A)) : undefined, mem(B).length ? Math.max(...mem(B)) : undefined, ' MB'],
    ['RAM trung bình (MB)', avg(mem(A)), avg(mem(B)), ' MB'],
    ['CPU trung bình (%)', avg(cpu(A)), avg(cpu(B)), ' %'],
    ['Khung hình giật (%)', A.perf?.frames?.jankPct, B.perf?.frames?.jankPct, ' %']
  ] as [string, number | undefined, number | undefined, string][]
  const hasPerf = perfRows.some((r) => r[1] !== undefined || r[2] !== undefined)

  /* ---- API */
  const ea = endpoints(A.calls)
  const eb = endpoints(B.calls)
  const keys = [...new Set([...ea.keys(), ...eb.keys()])].sort()
  const apiRows: string[] = []
  let apiNew = 0
  let apiGone = 0
  let apiBroken = 0
  for (const k of keys) {
    const a = ea.get(k)
    const b = eb.get(k)
    let tag = ''
    if (!a) {
      apiNew++
      tag = '<span class="tag">mới</span>'
    } else if (!b) {
      apiGone++
      tag = '<span class="tag warn">không còn gọi</span>'
    } else if (!a.fail && b.fail) {
      apiBroken++
      tag = '<span class="tag bad">mới lỗi</span>'
    } else if (a.fail && !b.fail) tag = '<span class="tag good">hết lỗi</span>'
    const ma = a ? median(a.ms) : undefined
    const mb = b ? median(b.ms) : undefined
    if (a && b && ma && mb && ma > 150 && mb > ma * 1.5) tag += ' <span class="tag warn">chậm hơn</span>'
    const cell = (e?: Ep): string => (e ? `${e.n} lần · ${[...e.statuses].join(', ')}${e.fail ? ` · <b class="bad">${e.fail} lỗi</b>` : ''}` : '<span class="muted">—</span>')
    apiRows.push(`<tr><th class="mono">${esc(k)}</th><td>${cell(a)}</td><td>${cell(b)}</td>${delta(ma, mb, ' ms', 0.5)}<td>${tag}</td></tr>`)
  }

  /* ---- screenshots with the same label */
  const shotRows: string[] = []
  for (const s of B.screenshots) {
    const a = A.screenshots.find((x) => x.label === s.label)
    if (!a) continue
    const diffName = `diff_${s.file}`
    const pct = diffImage(join(dirA, a.file), join(dirB, s.file), join(out, diffName))
    shotRows.push(`<div class="shot"><div class="shot-h"><b>${esc(s.label)}</b> ${pct === null ? '<span class="muted">khác kích thước — không so được</span>' : `<span class="${pct > 1 ? 'bad' : 'ok'}">khác ${pct}%</span>`}</div>
<div class="shot-row"><figure><img src="${href(dirA, a.file)}"><figcaption>Lần trước</figcaption></figure><figure><img src="${href(dirB, s.file)}"><figcaption>Lần này</figcaption></figure>${pct !== null ? `<figure><img src="${diffName}"><figcaption>Chỗ khác (đỏ)</figcaption></figure>` : ''}</div></div>`)
  }

  /* ---- JavaScript / WebView errors */
  const msgs = (r: Rep): Set<string> => new Set(r.webErrors.filter((e) => e.kind === 'exception' || e.kind === 'console').map((e) => e.message))
  const newErrors = [...msgs(B)].filter((m) => !msgs(A).has(m))

  const verdict = regress || apiBroken || newErrors.length ? 'bad' : fixed ? 'good' : 'ok'
  const head = (r: Rep, dir: string): string =>
    `<div class="card"><div class="muted">${esc(basename(dir))}</div><b>${r.appVersion ? `${esc(r.script.app)} phiên bản ${esc(r.appVersion)}` : r.script.app ? `${esc(r.script.app)} (không rõ phiên bản)` : 'kịch bản không gắn app'}</b><div>${r.device ? esc(`${r.device.manufacturer} ${r.device.model}, Android ${r.device.android}`) : esc(r.serial)}</div><div>${new Date(r.started).toLocaleString('vi-VN')} · <b class="${r.result === 'passed' ? 'ok' : 'bad'}">${esc(r.message)}</b></div><a href="${href(dir, 'report.html')}">mở báo cáo</a></div>`

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>So sánh — ${esc(B.script.name)}</title>
<style>body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1c2330}main{max-width:1250px;margin:0 auto;padding:24px}h2{font-size:16px;margin:26px 0 10px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:12px 16px}.muted{color:#6b7280}.mono{font-family:Consolas,monospace;font-size:12px}
.verdict{margin:16px 0;padding:12px 16px;border-radius:10px;font-weight:600}.verdict.bad{background:#fde8e8;color:#b42318}.verdict.good{background:#e7f6ec;color:#1f7a45}.verdict.ok{background:#eef2f7;color:#334}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3e6eb;border-radius:10px;overflow:hidden}th,td{padding:6px 10px;border-bottom:1px solid #eef0f3;text-align:left;vertical-align:top}thead th{background:#fafbfc}tbody th{font-weight:500}
.ok{color:#1f9d55}.bad{color:#d64545}.worse{color:#d64545;font-weight:600}.better{color:#1f9d55;font-weight:600}.m{font-size:12px;color:#8a1c1c}.row-bad{background:#fff4f4}.row-good{background:#f1fbf4}
.tag{font-size:11px;border-radius:8px;padding:1px 7px;background:#e8eefc;color:#2f4fb0;white-space:nowrap}.tag.bad{background:#fde8e8;color:#b42318}.tag.good{background:#e7f6ec;color:#1f7a45}.tag.warn{background:#fff3d6;color:#8a5a00}
.shot{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:10px 14px;margin-bottom:12px}.shot-row{display:flex;gap:10px}.shot-row figure{margin:0;flex:1}.shot-row img{width:100%;max-height:520px;object-fit:contain;background:#000;border-radius:8px}figcaption{color:#6b7280;font-size:12px}</style></head>
<body><main><h1 style="margin:0">So sánh: ${esc(B.script.name)}</h1>
<div class="cards">${head(A, dirA)}${head(B, dirB)}</div>
<div class="verdict ${verdict}">${
    verdict === 'bad'
      ? `Có thay đổi xấu: ${[regress && `${regress} bước mới lỗi`, apiBroken && `${apiBroken} API mới lỗi`, newErrors.length && `${newErrors.length} lỗi JS mới`].filter(Boolean).join(', ')}`
      : verdict === 'good'
        ? `Tốt hơn: ${fixed} bước đã hết lỗi`
        : 'Không có bước nào đổi kết quả'
  }${slower ? ` · ${slower} bước chậm hơn rõ rệt` : ''}${apiNew || apiGone ? ` · API: ${apiNew} mới, ${apiGone} không còn gọi` : ''}</div>
<h2>Các bước (${nSteps})</h2><table><thead><tr><th>Bước</th><th>Lần trước</th><th>Lần này</th><th></th></tr></thead><tbody>${stepRows.join('')}</tbody></table>
${hasPerf ? `<h2>Hiệu năng</h2><table><thead><tr><th>Chỉ số</th><th>Lần trước</th><th>Lần này</th><th>Chênh</th></tr></thead><tbody>${perfRows.map(([l, a, b, u]) => `<tr><th>${l}</th>${delta(a, b, u)}</tr>`).join('')}</tbody></table>` : ''}
${keys.length ? `<h2>API &amp; lệnh (${keys.length} endpoint)</h2><table><thead><tr><th>Endpoint</th><th>Lần trước</th><th>Lần này</th><th>Thời gian (trước)</th><th>(này)</th><th>Chênh</th><th></th></tr></thead><tbody>${apiRows.join('')}</tbody></table>` : ''}
${newErrors.length ? `<h2>Lỗi JS mới (${newErrors.length})</h2><table><tbody>${newErrors.slice(0, 50).map((m) => `<tr><td class="bad mono">${esc(m)}</td></tr>`).join('')}</tbody></table>` : ''}
${shotRows.length ? `<h2>Ảnh chụp cùng tên (${shotRows.length})</h2>${shotRows.join('')}` : ''}
</main></body></html>`
  const file = join(out, 'so-sanh.html')
  writeFileSync(file, html)
  return file
}
