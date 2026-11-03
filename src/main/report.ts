import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeviceDetails } from '../shared/types'
import { callFailed, expectedOf, type NetCall, type RunOptions, type Script, type WebError } from '../shared/automation'
import type { PerfData, VisualRecord } from './runner'

export interface StepResult {
  iteration: number
  index: number
  text: string
  state: 'ok' | 'failed' | 'warn'
  ms: number
  message?: string
}

export interface ReportData {
  script: Script
  options: RunOptions
  serial: string
  device: DeviceDetails | null
  started: Date
  finished: Date
  result: 'passed' | 'failed' | 'stopped' | 'crashed'
  message: string
  results: StepResult[]
  crash: { type: string; pkg: string; summary: string; lines: string[] } | null
  logcat: string[]
  screenshots: { label: string; file: string }[]
  failShot?: string
  videos: string[]
  webErrors: WebError[]
  calls: NetCall[]
  permsUsed: { op: string; mode: string; ago: string }[]
  visuals: VisualRecord[]
  appVersion: string
  mocksUsed: string[]
  perf: PerfData | null
}

/** Memory (MB) and CPU (%) over time as an inline SVG, with a tick at every step change. */
function perfChart(p: PerfData): string {
  const s = p.samples
  if (s.length < 2) return ''
  const W = 1000
  const H = 220
  const pad = { l: 46, r: 46, t: 14, b: 26 }
  const tMax = Math.max(1, s[s.length - 1].t)
  const memMax = Math.max(1, ...s.map((x) => x.memMb ?? 0)) * 1.15
  const cpuMax = Math.max(100, ...s.map((x) => x.cpu ?? 0))
  const X = (t: number): number => pad.l + (t / tMax) * (W - pad.l - pad.r)
  const Ym = (v: number): number => H - pad.b - (v / memMax) * (H - pad.t - pad.b)
  const Yc = (v: number): number => H - pad.b - (v / cpuMax) * (H - pad.t - pad.b)
  const line = (pts: [number, number][]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const mem = line(s.filter((x) => x.memMb !== undefined).map((x) => [X(x.t), Ym(x.memMb!)]))
  const cpu = line(s.filter((x) => x.cpu !== undefined).map((x) => [X(x.t), Yc(x.cpu!)]))
  const marks: string[] = []
  let prev = -1
  for (const x of s) {
    if (x.step !== prev && x.step > 0) {
      marks.push(`<line x1="${X(x.t)}" x2="${X(x.t)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#d6dae3" stroke-dasharray="3 3"/><text x="${X(x.t) + 3}" y="${pad.t + 10}" font-size="10" fill="#8a8f98">${x.step}</text>`)
      prev = x.step
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#fff;border:1px solid #e3e6eb;border-radius:10px">
    ${marks.join('')}
    <path d="${mem}" fill="none" stroke="#2f6feb" stroke-width="2"/>
    <path d="${cpu}" fill="none" stroke="#e07a1f" stroke-width="1.6"/>
    <text x="6" y="${pad.t + 4}" font-size="11" fill="#2f6feb">${Math.round(memMax)} MB</text>
    <text x="6" y="${H - pad.b}" font-size="11" fill="#2f6feb">0</text>
    <text x="${W - pad.r + 4}" y="${pad.t + 4}" font-size="11" fill="#e07a1f">${Math.round(cpuMax)}%</text>
    <text x="${W / 2}" y="${H - 6}" font-size="11" fill="#8a8f98" text-anchor="middle">${(tMax / 1000).toFixed(0)} giây · số trên vạch = bước</text>
  </svg>
  <div class="muted" style="margin-top:4px"><span style="color:#2f6feb">━ RAM (MB)</span> · <span style="color:#e07a1f">━ CPU (% một nhân)</span></div>`
}

function perfSection(p: PerfData | null): string {
  if (!p || (!p.samples.length && !p.startups.length && !p.frames)) return ''
  const mems = p.samples.map((s) => s.memMb).filter((v): v is number => v !== undefined)
  const cpus = p.samples.map((s) => s.cpu).filter((v): v is number => v !== undefined)
  const avg = (a: number[]): string => (a.length ? (Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10).toString() : '—')
  const peak = (a: number[]): string => (a.length ? Math.max(...a).toString() : '—')
  const f = p.frames
  const card = (label: string, value: string, sub = ''): string =>
    `<div class="card" style="min-width:150px"><div class="muted">${label}</div><b style="font-size:20px">${value}</b>${sub ? `<div class="muted">${sub}</div>` : ''}</div>`
  return `<h2>Hiệu năng</h2>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
    ${p.startups.map((s) => card(`Mở app (bước ${s.step})`, `${s.ms} ms`, s.cold ? 'khởi động nguội' : 'app đang chạy sẵn')).join('')}
    ${mems.length ? card('RAM cao nhất', `${peak(mems)} MB`, `trung bình ${avg(mems)} MB`) : ''}
    ${cpus.length ? card('CPU cao nhất', `${peak(cpus)} %`, `trung bình ${avg(cpus)} %`) : ''}
    ${f ? card('Khung hình giật', `${f.jankPct} %`, `${f.janky}/${f.frames} khung · p90 ${f.p90 ?? '?'}ms · p99 ${f.p99 ?? '?'}ms`) : ''}
  </div>
  ${perfChart(p)}`
}

/**
 * Ready-to-paste bug description (Markdown, works in Jira / Redmine / GitLab / Teams):
 * title, environment, reproduction steps, expected vs actual, evidence and attachments.
 */
export function bugReport(r: ReportData, reportPath: string): string {
  const d = r.device
  const lastIter = r.results.length ? r.results[r.results.length - 1].iteration : 0
  const steps = r.results.filter((x) => x.iteration === lastIter)
  const failed = steps.find((x) => x.state === 'failed')
  const title = `[${r.script.app || 'App'}] ${failed ? `${failed.text} — ${failed.message ?? 'lỗi'}` : r.message}`.slice(0, 180)
  const jsErrors = r.webErrors.filter((e) => e.kind === 'exception' || e.kind === 'console').slice(0, 3)
  const badCalls = r.calls.filter(callFailed).slice(0, 5)
  const vis = r.visuals.filter((v) => !v.created && (v.sizeMismatch || v.diffPercent > v.tolerance))
  const dir = reportPath.replace(/[\\/][^\\/]+$/, '')
  const lines = [
    `**${title}**`,
    '',
    '**Môi trường**',
    `- Thiết bị: ${d ? `${d.manufacturer} ${d.model}, Android ${d.android} (API ${d.sdk}), màn hình ${d.screen}` : r.serial}`,
    `- App: ${r.script.app || '—'}${r.appVersion ? ` phiên bản ${r.appVersion}` : ''}`,
    `- Thời điểm: ${r.started.toLocaleString('vi-VN')}`,
    `- Kịch bản: ${r.script.name}${r.mocksUsed.length ? ` (giả lập: ${r.mocksUsed.join('; ')})` : ''}`,
    '',
    '**Các bước tái hiện**',
    ...steps.map((x, i) => `${i + 1}. ${x.text}${x.state === 'failed' ? '  ← lỗi ở đây' : ''}`),
    '',
    '**Kết quả mong muốn**',
    expectedOf(r.script),
    '',
    '**Kết quả thực tế**',
    `- ${r.message}`,
    ...(r.crash ? [`- ${r.crash.type.toUpperCase()} trong ${r.crash.pkg}: ${r.crash.summary}`] : []),
    ...vis.map((v) => `- Màn hình "${v.name}" ${v.sizeMismatch ?? `khác ảnh chuẩn ${v.diffPercent}%`}`),
    ...(r.perf?.startups.length ? [`- Thời gian mở app: ${r.perf.startups.map((s) => `${s.ms} ms`).join(', ')}`] : []),
    ...(r.perf?.frames ? [`- Khung hình giật: ${r.perf.frames.jankPct}% (${r.perf.frames.janky}/${r.perf.frames.frames})`] : []),
    ...jsErrors.map((e) => `- Lỗi JS: ${e.message}${e.source ? ` (${e.source})` : ''}`),
    ...badCalls.map((c) => `- API lỗi: ${c.method} ${c.url} → ${c.status || c.error || 'lỗi'}`),
    '',
    '**Đính kèm** (thư mục báo cáo)',
    `- ${dir}`,
    `- report.html${r.videos.length ? `, ${r.videos.join(', ')}` : ''}, logcat.txt${r.failShot ? `, ${r.failShot}` : ''}${vis.length ? `, ${vis.map((v) => v.diffFile).filter(Boolean).join(', ')}` : ''}`
  ]
  return lines.join('\n')
}

/** HTTP calls as a HAR 1.2 file — opens in Chrome DevTools (Network → Import HAR). */
function toHar(r: ReportData): object {
  return harOf(r.calls)
}

export function harOf(calls: NetCall[]): object {
  const entries = calls
    .filter((c) => c.kind === 'http')
    .map((c) => ({
      startedDateTime: new Date(c.startedAt).toISOString(),
      time: c.durationMs ?? 0,
      request: {
        method: c.method,
        url: c.url,
        httpVersion: 'HTTP/1.1',
        headers: c.reqHeaders ?? [],
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: c.args?.length ?? 0,
        ...(c.args ? { postData: { mimeType: 'application/json', text: c.args } } : {})
      },
      response: {
        status: c.status ?? 0,
        statusText: c.error ?? '',
        httpVersion: 'HTTP/1.1',
        headers: c.resHeaders ?? [],
        cookies: [],
        content: { size: c.result?.length ?? 0, mimeType: (c.source === 'chucker' && c.resourceType) || 'application/json', text: c.result ?? '' },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1
      },
      cache: {},
      timings: { send: 0, wait: c.durationMs ?? 0, receive: 0 },
      comment: `bước ${c.step ?? 0}${c.viaTauri ? ' · Tauri HTTP plugin' : ''}`
    }))
  return { log: { version: '1.2', creator: { name: 'ADB Kit', version: '0.1' }, entries } }
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const RESULT: Record<ReportData['result'], { label: string; color: string }> = {
  passed: { label: 'ĐẠT', color: '#1f9d55' },
  failed: { label: 'LỖI', color: '#d64545' },
  crashed: { label: 'CRASH', color: '#b3261e' },
  stopped: { label: 'ĐÃ DỪNG', color: '#8a8f98' }
}
const STATE: Record<StepResult['state'], string> = { ok: 'đạt', warn: 'cảnh báo', failed: 'lỗi' }
const WEB_KIND: Record<WebError['kind'], string> = {
  exception: 'Lỗi JS',
  console: 'console.error',
  network: 'Mạng',
  log: 'Trình duyệt'
}

export function logClass(l: string): string {
  const m = /^\S+ \S+\s+\d+\s+\d+ ([VDIWEF]) /.exec(l)
  return m ? `l${m[1]}` : ''
}

/** Same message from the same place counts once (with a counter). */
function groupWebErrors(list: WebError[]): (WebError & { count: number; steps: string })[] {
  const map = new Map<string, WebError & { count: number; stepSet: Set<string> }>()
  for (const e of list) {
    const key = `${e.kind}|${e.message}|${e.source ?? ''}`
    const g = map.get(key)
    const st = e.step ? `${e.step}${e.iteration > 1 ? ` (lượt ${e.iteration})` : ''}` : 'trước bước 1'
    if (g) {
      g.count++
      g.stepSet.add(st)
    } else map.set(key, { ...e, count: 1, stepSet: new Set([st]) })
  }
  return [...map.values()].map((g) => ({ ...g, steps: [...g.stepSet].slice(0, 6).join(', ') + (g.stepSet.size > 6 ? '…' : '') }))
}

/** Writes report.html + logcat.txt into `dir` and returns the HTML path. */
export function writeReport(dir: string, r: ReportData): string {
  writeFileSync(join(dir, 'logcat.txt'), r.logcat.join('\n'))
  const httpCount = r.calls.filter((c) => c.kind === 'http').length
  if (httpCount) writeFileSync(join(dir, 'api.har'), JSON.stringify(toHar(r), null, 1))
  const t0 = r.started.getTime()
  const failedCalls = r.calls.filter(callFailed).length
  const callRows = r.calls
    .slice(0, 800)
    .map((c) => {
      const label =
        c.source === 'bridge'
          ? c.kind === 'ipc' ? 'Bridge miniapp' : 'HTTP (bridge)'
          : c.kind === 'ipc' ? 'Lệnh Tauri' : c.viaTauri ? 'HTTP (Rust)' : 'HTTP'
      const status = c.status === undefined ? '…' : c.kind === 'ipc' ? (c.status === 200 ? 'ok' : 'lỗi') : c.status || 'lỗi'
      const detail =
        c.args || c.result || c.error
          ? `<details><summary>chi tiết</summary>${c.args ? `<div class="muted">Gửi đi</div><pre>${esc(c.args)}</pre>` : ''}${
              c.result || c.error ? `<div class="muted">Nhận về</div><pre>${esc(c.error ?? c.result ?? '')}</pre>` : ''
            }</details>`
          : ''
      return `<tr class="${callFailed(c) ? 'failed' : ''}"><td>+${((c.startedAt - t0) / 1000).toFixed(1)}s</td><td>${c.step ?? ''}</td><td><span class="kind ${c.kind}">${label}</span></td><td>${esc(
        c.method
      )}</td><td class="url">${esc(c.url)}${detail}</td><td>${esc(String(status))}</td><td>${c.durationMs ?? ''}${c.durationMs !== undefined ? ' ms' : ''}</td></tr>`
    })
    .join('')
  const callsSection = r.calls.length
    ? `<h2>API / lệnh đã gọi (${r.calls.length}${failedCalls ? ` · ${failedCalls} lỗi` : ''})</h2>
  <div class="muted" style="margin-bottom:8px">HTTP = request từ WebView; HTTP (Rust) = request qua plugin HTTP của Tauri; Lệnh Tauri = lệnh JS → Rust (vd. truy vấn SQL).${
    httpCount ? ` Mở <a href="api.har">api.har</a> bằng Chrome DevTools → Network → Import để xem chi tiết.` : ''
  }</div>
  <table class="calls"><tr><th>Lúc</th><th>Bước</th><th>Loại</th><th>Method</th><th>URL / lệnh</th><th>Status</th><th>Thời gian</th></tr>${callRows}</table>`
    : ''
  const visualSection = r.visuals.length
    ? `<h2>So sánh màn hình với ảnh chuẩn</h2>${r.visuals
        .map((v) => {
          const bad = !v.created && (v.sizeMismatch || v.diffPercent > v.tolerance)
          const head = v.created
            ? `<span class="badge" style="background:#8a8f98">ẢNH CHUẨN MỚI</span> chưa có ảnh chuẩn — màn hình này đã được lưu làm ảnh chuẩn`
            : bad
              ? `<span class="badge" style="background:#d64545">KHÁC</span> ${esc(v.sizeMismatch ?? `lệch ${v.diffPercent}% (cho phép ${v.tolerance}%)`)}`
              : `<span class="badge" style="background:#1f9d55">KHỚP</span> lệch ${v.diffPercent}% (cho phép ${v.tolerance}%)`
          const img = (f: string | undefined, cap: string): string =>
            f ? `<figure><a href="${esc(f)}"><img src="${esc(f)}"></a><figcaption>${cap}</figcaption></figure>` : ''
          return `<div class="card" style="margin-bottom:12px"><b>Bước ${v.step}${v.iteration > 1 ? ` (lượt ${v.iteration})` : ''}: "${esc(v.name)}"</b> ${head}
          <div class="shots" style="margin-top:10px">${img(v.baselineFile, 'Ảnh chuẩn')}${v.created ? '' : img(v.currentFile, 'Hiện tại')}${img(v.diffFile, 'Khác biệt (đỏ)')}</div></div>`
        })
        .join('')}`
    : ''
  const mocksSection = r.mocksUsed.length
    ? `<h2>Giả lập API trong lần chạy</h2><div class="card">${r.mocksUsed.map((m) => esc(m)).join('<br>')}</div>`
    : ''
  const bug = r.result === 'passed' || r.result === 'stopped' ? '' : bugReport(r, join(dir, 'report.html'))
  const bugSection = bug
    ? `<h2>Nội dung báo lỗi (dán vào Jira / Redmine…)</h2>
  <div class="card"><textarea id="bug" readonly style="width:100%;height:260px;font:12.5px Consolas,monospace;border:1px solid #e3e6eb;border-radius:6px;padding:8px">${esc(bug)}</textarea>
  <button onclick="const t=document.getElementById('bug');t.select();(navigator.clipboard?navigator.clipboard.writeText(t.value):Promise.reject()).catch(()=>document.execCommand('copy'));this.textContent='Đã chép ✓'" style="margin-top:8px;padding:6px 14px;border-radius:6px;border:0;background:#1f6feb;color:#fff;font-weight:600;cursor:pointer">Chép nội dung báo lỗi</button>
  <span class="muted"> · cũng lưu trong <a href="bao-loi.md">bao-loi.md</a></span></div>`
    : ''
  const permsSection = r.permsUsed.length
    ? `<h2>Quyền / thao tác nhạy cảm app đã dùng trong lúc test</h2><div class="card">${r.permsUsed
        .map((p) => `<span class="kind">${esc(p.op)}</span> ${esc(p.ago)} <span class="muted">(chế độ: ${esc(p.mode)})</span>`)
        .join('<br>')}</div>`
    : ''
  const d = r.device
  const res = RESULT[r.result]
  const dur = ((r.finished.getTime() - r.started.getTime()) / 1000).toFixed(1)
  const failed = r.results.filter((x) => x.state === 'failed').length
  const warned = r.results.filter((x) => x.state === 'warn').length
  const tail = r.logcat.slice(-400)
  const web = groupWebErrors(r.webErrors)
  const jsCount = r.webErrors.filter((e) => e.kind === 'exception' || e.kind === 'console').length
  const netCount = r.webErrors.filter((e) => e.kind === 'network').length

  // Steps of the last iteration up to the failure are the reproduction steps.
  const lastIter = r.results.length ? r.results[r.results.length - 1].iteration : 0
  const repro = r.results.filter((x) => x.iteration === lastIter)

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<title>${esc(r.script.name)} — ${res.label}</title>
<style>
  body { font: 14px/1.5 'Segoe UI', system-ui, sans-serif; margin: 0; background: #f5f6f8; color: #1d2330; }
  main { max-width: 1100px; margin: 0 auto; padding: 28px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { font-size: 15px; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: .6px; color: #5b6475; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 99px; color: #fff; font-weight: 600; font-size: 12px; background: ${res.color}; vertical-align: middle; }
  .card { background: #fff; border: 1px solid #e3e6eb; border-radius: 10px; padding: 16px 18px; }
  .msg { font-size: 15px; margin-top: 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 24px; }
  .grid b { color: #5b6475; font-weight: 500; display: inline-block; min-width: 100px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e3e6eb; border-radius: 10px; overflow: hidden; }
  td, th { padding: 7px 10px; border-bottom: 1px solid #eef0f3; text-align: left; vertical-align: top; }
  th { background: #fafbfc; font-weight: 600; color: #5b6475; font-size: 12px; }
  tr.failed td { background: #fff1f1; } tr.warn td { background: #fff8e6; }
  .st { font-weight: 600; } .st.ok { color: #1f9d55; } .st.failed { color: #d64545; } .st.warn { color: #b7791f; }
  pre { background: #0f1216; color: #cfd6df; padding: 14px; border-radius: 10px; overflow: auto; font: 12px/1.45 Consolas, monospace; max-height: 520px; }
  pre .lE, pre .lF { color: #ff8b8b; } pre .lW { color: #f2c46b; } pre .lI { color: #8fe3b0; } pre .lD { color: #8cc4ff; } pre .lV { color: #8b93a1; }
  .shots { display: flex; flex-wrap: wrap; gap: 14px; }
  .shots figure { margin: 0; background: #fff; border: 1px solid #e3e6eb; border-radius: 10px; padding: 8px; }
  .shots img { max-height: 420px; display: block; border-radius: 6px; }
  .shots figcaption { font-size: 12px; color: #5b6475; margin-top: 6px; }
  video { max-height: 640px; max-width: 100%; border-radius: 10px; background: #000; display: block; }
  .videos { display: flex; gap: 14px; flex-wrap: wrap; }
  ol li { margin: 3px 0; }
  .muted { color: #8a8f98; }
  .kind { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: #eef0f3; color: #5b6475; margin-right: 6px; }
  .kind.exception, .kind.console { background: #fde8e8; color: #b3261e; } .kind.network { background: #fff3d6; color: #8a5a00; }
  .web td pre { margin: 6px 0 0; max-height: 220px; }
  .kind.ipc { background: #e8eefc; color: #2f4f9e; } .kind.http { background: #e6f6ec; color: #1f7a45; }
  table.calls td { font-size: 12.5px; } table.calls td.url { word-break: break-all; font-family: Consolas, monospace; font-size: 12px; }
  table.calls pre { max-height: 260px; margin: 4px 0; white-space: pre-wrap; word-break: break-all; }
  details summary { cursor: pointer; color: #5b6475; font-family: 'Segoe UI', sans-serif; }
</style></head>
<body><main>
  <h1>${esc(r.script.name)} <span class="badge">${res.label}</span></h1>
  <div class="muted">${r.started.toLocaleString('vi-VN')} · ${dur} giây · ${r.results.length} lượt bước · ${failed} lỗi · ${warned} cảnh báo${r.webErrors.length ? ` · ${jsCount} lỗi JS · ${netCount} lỗi mạng` : ''}</div>
  <div class="card msg">${esc(r.message)}</div>

  ${
    r.crash
      ? `<h2>${r.crash.type === 'anr' ? 'ANR (app treo)' : r.crash.type === 'native' ? 'Crash native' : 'Crash'} trong ${esc(r.crash.pkg)}</h2>
  <div class="card"><b>${esc(r.crash.summary)}</b></div>
  <pre>${r.crash.lines.map((l) => `<span class="${logClass(l)}">${esc(l)}</span>`).join('\n')}</pre>`
      : ''
  }

  ${
    r.result !== 'passed'
      ? `<h2>Các bước để tái hiện</h2>
  <div class="card"><ol>${repro.map((x) => `<li>${esc(x.text)}${x.state === 'failed' ? ` <b style="color:#d64545">← ${esc(x.message ?? 'lỗi')}</b>` : ''}</li>`).join('')}</ol></div>`
      : ''
  }

  ${
    r.videos.length
      ? `<h2>Video quá trình chạy</h2><div class="videos">${r.videos
          .map((v) => `<div><video src="${esc(v)}" controls preload="metadata"></video><div class="muted"><a href="${esc(v)}">${esc(v)}</a></div></div>`)
          .join('')}</div>`
      : ''
  }

  ${
    web.length
      ? `<h2>Lỗi WebView (${r.webErrors.length})</h2>
  <table class="web"><tr><th>Loại</th><th>Nội dung</th><th>Bước</th><th>Số lần</th></tr>
  ${web
    .map(
      (e) =>
        `<tr><td><span class="kind ${e.kind}">${WEB_KIND[e.kind]}</span></td><td>${esc(e.message)}${e.source ? `<div class="muted">${esc(e.source)}</div>` : ''}${
          e.stack && e.stack !== e.message ? `<pre>${esc(e.stack)}</pre>` : ''
        }</td><td>${esc(e.steps)}</td><td>${e.count}</td></tr>`
    )
    .join('')}
  </table>`
      : r.options.webErrors && r.script.app
        ? `<h2>Lỗi WebView</h2><div class="card muted">Không ghi nhận lỗi JS / mạng nào.</div>`
        : ''
  }

  ${bugSection}
  ${perfSection(r.perf)}
  ${visualSection}
  ${mocksSection}
  ${callsSection}
  ${permsSection}

  <h2>Thiết bị</h2>
  <div class="card grid">
    <div><b>Máy</b> ${esc(d ? `${d.manufacturer} ${d.model}` : r.serial)}</div>
    <div><b>Android</b> ${esc(d ? `${d.android} (API ${d.sdk})` : '?')}</div>
    <div><b>Serial</b> ${esc(r.serial)}</div>
    <div><b>Màn hình</b> ${esc(d?.screen ?? '?')}</div>
    <div><b>App</b> ${esc(r.script.app || '—')}</div>
    <div><b>Số lượt</b> ${r.options.repeat}</div>
    <div><b>Tìm phần tử</b> ${r.options.smartTargets ? 'bật' : 'tắt'}</div>
    <div><b>Tốc độ</b> ×${r.options.speed}</div>
  </div>

  ${
    r.screenshots.length
      ? `<h2>Ảnh chụp màn hình</h2><div class="shots">${r.screenshots
          .map((s) => `<figure><a href="${esc(s.file)}"><img src="${esc(s.file)}"></a><figcaption>${esc(s.label)}${s.file === r.failShot ? ' (lúc lỗi)' : ''}</figcaption></figure>`)
          .join('')}</div>`
      : ''
  }

  <h2>Nhật ký các bước</h2>
  <table><tr><th>#</th><th>Lượt</th><th>Bước</th><th>Kết quả</th><th>Thời gian</th></tr>
  ${r.results
    .map(
      (x) =>
        `<tr class="${x.state}"><td>${x.index + 1}</td><td>${x.iteration + 1}</td><td>${esc(x.text)}${x.message ? `<div class="muted">${esc(x.message)}</div>` : ''}</td><td class="st ${x.state}">${STATE[x.state]}</td><td>${x.ms} ms</td></tr>`
    )
    .join('')}
  </table>

  <h2>Logcat (${tail.length} dòng cuối — đầy đủ trong <a href="logcat.txt">logcat.txt</a>)</h2>
  <pre>${tail.map((l) => `<span class="${logClass(l)}">${esc(l)}</span>`).join('\n')}</pre>
</main></body></html>`
  const path = join(dir, 'report.html')
  writeFileSync(path, html)
  return path
}
