import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import JSZip from 'jszip'
import { adb, adbBinary, deviceDetails, q, shell } from './adb'
import { foregroundPackage, pidsOf } from './services'
import { dumpUi } from './ui'
import { esc, harOf, logClass } from './report'
import { callFailed, type NetCall, type WebError } from '../shared/automation'
import type { BugInput, BugResult, BugSnap } from '../shared/bug'
import type { DeviceDetails } from '../shared/types'

/* ------------------------------------------- recent calls from the Mạng / API tab */

type Err = Omit<WebError, 'step' | 'iteration'>
const KEEP_MS = 5 * 60_000
const calls = new Map<string, { pkg: string; c: NetCall }>()
const errors: { pkg: string; e: Err }[] = []

/** Remember a call seen by the live network watcher (same id = updated call). */
export function noteCall(pkg: string, c: NetCall): void {
  calls.delete(c.id) // re-insert so the map stays in update order
  calls.set(c.id, { pkg, c })
  if (calls.size > 800) for (const k of [...calls.keys()].slice(0, calls.size - 800)) calls.delete(k)
}

export function noteError(pkg: string, e: Err): void {
  errors.push({ pkg, e })
  if (errors.length > 200) errors.splice(0, errors.length - 200)
}

const recentCalls = (pkg: string | null): NetCall[] => {
  const since = Date.now() - KEEP_MS
  return [...calls.values()].filter((x) => (!pkg || x.pkg === pkg) && x.c.startedAt >= since).map((x) => x.c).sort((a, b) => a.startedAt - b.startedAt)
}
const recentErrors = (pkg: string | null): Err[] => {
  const since = Date.now() - KEEP_MS
  return errors.filter((x) => (!pkg || x.pkg === pkg) && x.e.at >= since).map((x) => x.e)
}

/* ------------------------------------------------------------------ snapshot */

interface Snap {
  serial: string
  dir: string
  at: Date
  pkg: string | null
  activity: string | null
  device: DeviceDetails | null
  logcat: string
  crash: string
  calls: NetCall[]
  errors: Err[]
}
const snaps = new Map<string, Snap>()

/**
 * Capture the evidence right away, while the screen still shows the problem:
 * screenshot, logcat, crash buffer, UI tree, foreground app/screen and recent API calls.
 */
export async function snapBug(serial: string, reportsRoot: string): Promise<BugSnap> {
  const at = new Date()
  const stamp = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(reportsRoot, `${stamp}_bao-loi`)
  mkdirSync(dir, { recursive: true })
  const [png, log, crash, pkg, act, device, ui] = await Promise.all([
    adbBinary(['-s', serial, 'exec-out', 'screencap', '-p']),
    adb(['-s', serial, 'logcat', '-d', '-v', 'threadtime', '-t', '6000'], 20_000),
    adb(['-s', serial, 'logcat', '-d', '-b', 'crash', '-v', 'threadtime', '-t', '300'], 10_000),
    foregroundPackage(serial).catch(() => null),
    shell(serial, 'dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -1'),
    deviceDetails(serial).catch(() => null),
    dumpUi(serial).catch(() => null)
  ])
  writeFileSync(join(dir, 'screenshot.png'), png)
  if (ui) writeFileSync(join(dir, 'ui.json'), JSON.stringify(ui, null, 1))
  const activity = /\{\S+ u\d+ (\S+)/.exec(act.stdout)?.[1] ?? null
  // Crash buffer: only crashes from the last 10 minutes are relevant to this report.
  const crashText = recentLines(crash.stdout, at, 10 * 60_000).join('\n').trim()
  const id = basename(dir)
  const callList = recentCalls(pkg)
  const errList = recentErrors(pkg)
  snaps.set(id, { serial, dir, at, pkg, activity, device, logcat: log.stdout, crash: crashText, calls: callList, errors: errList })
  return {
    id,
    pkg,
    activity,
    png: new Uint8Array(png),
    calls: callList.length,
    failedCalls: callList.filter(callFailed).length,
    errors: errList.length,
    crash: !!crashText
  }
}

/** threadtime lines ("11-03 08:40:54.623 …") not older than `ms` before `at` (device ≈ PC clock). */
function recentLines(text: string, at: Date, ms: number): string[] {
  const year = at.getFullYear()
  return text.split(/\r?\n/).filter((l) => {
    const m = /^(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(l)
    if (!m) return !!l.trim() && !l.startsWith('---------')
    const t = new Date(year, Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])).getTime()
    return t >= at.getTime() - ms
  })
}

export function discardBug(id: string): void {
  const s = snaps.get(id)
  snaps.delete(id)
  if (s) rmSync(s.dir, { recursive: true, force: true })
}

/* ------------------------------------------------------------------- writing */

const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString('vi-VN')
/** "12 giây trước" / "2 phút 5 giây trước" relative to the report time. */
function ago(t0: number, at: number): string {
  const s = Math.max(0, Math.round((t0 - at) / 1000))
  return s < 60 ? `${s} giây trước` : `${Math.floor(s / 60)} phút ${s % 60} giây trước`
}

export async function saveBug(id: string, input: BugInput): Promise<BugResult> {
  const s = snaps.get(id)
  if (!s) throw new Error('Phiên báo lỗi đã hết hạn, hãy bấm Báo lỗi lại')
  const pkg = input.pkg || s.pkg || ''
  const [pids, ver] = await Promise.all([
    pkg ? pidsOf(s.serial, pkg).catch(() => []) : Promise.resolve([] as number[]),
    pkg ? shell(s.serial, `dumpsys package ${q(pkg)} | grep -m1 versionName`) : Promise.resolve({ stdout: '' })
  ])
  const version = /versionName=(\S+)/.exec(ver.stdout)?.[1] ?? ''
  // The snapshot's call list was for the foreground app; refresh it if the tester picked another.
  const callList = pkg && pkg !== s.pkg ? recentCalls(pkg).filter((c) => c.startedAt <= s.at.getTime()) : s.calls
  const errList = pkg && pkg !== s.pkg ? recentErrors(pkg) : s.errors

  const all = s.logcat.split(/\r?\n/)
  const pidSet = new Set(pids.map(String))
  const appLines = all.filter((l) => {
    const m = /^\S+ \S+\s+(\d+)\s/.exec(l)
    return (m && pidSet.has(m[1])) || (pkg && l.includes(pkg))
  })
  writeFileSync(join(s.dir, 'logcat.txt'), s.logcat)
  if (appLines.length) writeFileSync(join(s.dir, 'logcat-app.txt'), appLines.join('\n'))
  if (s.crash) writeFileSync(join(s.dir, 'crash.txt'), s.crash)
  const videos = input.videos.map((v, i) => {
    const name = input.videos.length > 1 ? `video-${i + 1}.webm` : 'video.webm'
    writeFileSync(join(s.dir, name), Buffer.from(v.data))
    return { name, ...v }
  })
  if (callList.some((c) => c.kind === 'http')) writeFileSync(join(s.dir, 'api.har'), JSON.stringify(harOf(callList), null, 1))
  if (callList.length) writeFileSync(join(s.dir, 'calls.json'), JSON.stringify(callList, null, 1))

  const ctx: Ctx = { s, input, pkg, version, callList, errList, appLines, videos }
  const markdown = toMarkdown(ctx)
  writeFileSync(join(s.dir, 'bug.md'), markdown)
  const html = join(s.dir, 'report.html')
  writeFileSync(html, toHtml(ctx))

  // One file to attach to the ticket.
  const zipFile = join(s.dir, `${basename(s.dir)}.zip`)
  const zip = new JSZip()
  for (const f of readdirSync(s.dir)) if (!f.endsWith('.zip')) zip.file(f, readFileSync(join(s.dir, f)))
  writeFileSync(zipFile, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }))
  snaps.delete(id)
  return { dir: s.dir, html, zip: zipFile, markdown }
}

interface Ctx {
  s: Snap
  input: BugInput
  pkg: string
  version: string
  callList: NetCall[]
  errList: Err[]
  appLines: string[]
  videos: { name: string; startedAt: number; endedAt: number }[]
}

const callLabel = (c: NetCall): string =>
  c.kind === 'ipc' ? (c.source === 'bridge' ? `bridge ${c.url}` : `lệnh ${c.url}`) : `${c.method} ${c.url}`
const callStatus = (c: NetCall): string =>
  c.status === undefined ? 'đang chờ' : c.kind === 'ipc' ? (c.status === 200 ? 'ok' : `lỗi${c.error ? `: ${c.error.slice(0, 120)}` : ''}`) : c.status ? String(c.status) : `lỗi${c.error ? `: ${c.error}` : ''}`

function crashSummary(crash: string): string {
  const lines = crash.split('\n')
  const i = lines.findIndex((l) => /FATAL EXCEPTION|Exception|Error:/.test(l))
  if (i < 0) return ''
  const ex = lines.slice(i, i + 4).map((l) => l.replace(/^\S+ \S+\s+\d+\s+\d+ \w \S+\s*:\s?/, '')).find((l) => /Exception|Error/.test(l) && !/FATAL/.test(l))
  return ex?.trim() ?? ''
}

function toMarkdown(x: Ctx): string {
  const { s, input } = x
  const d = s.device
  const bad = x.callList.filter(callFailed).slice(-6)
  const js = x.errList.filter((e) => e.kind === 'exception' || e.kind === 'console').slice(-3)
  const crash = crashSummary(s.crash)
  const t0 = s.at.getTime()
  return [
    `**${input.title || 'Lỗi chưa đặt tên'}**`,
    '',
    `**Mức độ:** ${input.severity}`,
    '',
    '**Môi trường**',
    `- Thiết bị: ${d ? `${d.manufacturer} ${d.model}, Android ${d.android} (API ${d.sdk}), màn hình ${d.screen}` : s.serial}`,
    `- App: ${x.pkg || '—'}${x.version ? ` phiên bản ${x.version}` : ''}`,
    ...(s.activity ? [`- Màn hình: ${s.activity}`] : []),
    `- Thời điểm: ${s.at.toLocaleString('vi-VN')}`,
    '',
    '**Các bước tái hiện**',
    ...(input.trail.length
      ? input.trail.map((t, i) => `${i + 1}. ${t.text}  _(${ago(t0, t.at)})_`)
      : ['1. (chưa ghi lại thao tác — xem video đính kèm)']),
    '',
    '**Kết quả thực tế**',
    input.actual || '(xem ảnh / video)',
    ...(crash ? [`- App bị crash: ${crash}`] : []),
    ...js.map((e) => `- Lỗi JS: ${e.message}${e.source ? ` (${e.source})` : ''}`),
    ...bad.map((c) => `- API lỗi: ${callLabel(c)} → ${callStatus(c)}`),
    '',
    '**Kết quả mong muốn**',
    input.expected || '—',
    '',
    '**Đính kèm**',
    `- ${basename(s.dir)}.zip (ảnh màn hình${x.videos.length ? ', video' : ''}, logcat${x.callList.length ? ', api.har' : ''}, report.html)`,
    `- Thư mục: ${s.dir}`
  ].join('\n')
}

function toHtml(x: Ctx): string {
  const { s, input } = x
  const d = s.device
  const t0 = s.at.getTime()
  const crash = crashSummary(s.crash)
  const row = (k: string, v: string): string => (v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : '')
  const calls = x.callList.slice(-150)
  const log = x.appLines.length ? x.appLines.slice(-500) : s.logcat.split(/\r?\n/).slice(-300)
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(input.title || 'Báo lỗi')}</title>
<style>
body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1c2330}
main{max-width:1180px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:28px 0 10px}
.muted{color:#6b7280}.sev{display:inline-block;padding:2px 10px;border-radius:12px;background:#fde8e8;color:#b42318;font-weight:600;font-size:12px}
.card{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:14px 16px}
.grid{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:start}
.media{display:flex;gap:12px;flex-wrap:wrap}.media img,.media video{max-height:620px;border-radius:10px;border:1px solid #e3e6eb;background:#000}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #eef0f3;vertical-align:top}
th{color:#6b7280;font-weight:500;white-space:nowrap;width:1%}
.calls td{font-family:Consolas,monospace;font-size:12px;word-break:break-all}.bad td{color:#b42318}
ol{margin:0;padding-left:22px} pre{white-space:pre-wrap;margin:0;font:inherit}
.log{font:12px/1.45 Consolas,monospace;background:#0f1216;color:#cfd6df;padding:12px;border-radius:10px;max-height:520px;overflow:auto}
.lE,.lF{color:#ff8a8a}.lW{color:#f2c46b}.lD,.lV{color:#8b93a1}
.crash{background:#fff4f4;border:1px solid #f5c2c2;color:#8a1c1c;font:12px/1.45 Consolas,monospace;padding:12px;border-radius:10px;overflow:auto;max-height:360px}
</style></head><body><main>
<h1>${esc(input.title || 'Lỗi chưa đặt tên')}</h1>
<div class="muted"><span class="sev">${esc(input.severity)}</span> · ${esc(s.at.toLocaleString('vi-VN'))} · báo bằng ADB Kit</div>

<div class="grid" style="margin-top:18px">
<div class="media">
  <a href="screenshot.png"><img src="screenshot.png" alt="Ảnh màn hình lúc báo lỗi"></a>
  ${x.videos.map((v) => `<figure style="margin:0"><video src="${v.name}" controls muted></video><figcaption class="muted">${esc(fmtTime(v.startedAt))} – ${esc(fmtTime(v.endedAt))}</figcaption></figure>`).join('')}
</div>
<div>
<div class="card"><table>
${row('Thiết bị', d ? `${d.manufacturer} ${d.model}` : s.serial)}
${row('Android', d ? `${d.android} (API ${d.sdk})` : '')}
${row('Màn hình', d?.screen ?? '')}
${row('App', x.pkg)}
${row('Phiên bản', x.version)}
${row('Màn đang mở', s.activity ?? '')}
</table></div>
<h2>Kết quả thực tế</h2><div class="card"><pre>${esc(input.actual || '(xem ảnh / video)')}</pre>${crash ? `<p class="bad" style="color:#b42318;margin:8px 0 0"><b>App bị crash:</b> ${esc(crash)}</p>` : ''}</div>
<h2>Kết quả mong muốn</h2><div class="card"><pre>${esc(input.expected || '—')}</pre></div>
<h2>Thao tác trước khi lỗi</h2><div class="card">${
    input.trail.length
      ? `<ol>${input.trail.map((t) => `<li>${esc(t.text)} <span class="muted">(${ago(t0, t.at)})</span></li>`).join('')}</ol>`
      : '<span class="muted">Không có thao tác nào trên màn mirror trong 3 phút trước đó — xem video.</span>'
  }</div>
</div></div>

${s.crash ? `<h2>Crash</h2><div class="crash"><pre>${esc(s.crash)}</pre></div>` : ''}
${
    x.errList.length
      ? `<h2>Lỗi JS / WebView (${x.errList.length})</h2><div class="card"><table class="calls">${x.errList
          .slice(-50)
          .map((e) => `<tr class="bad"><th>${esc(fmtTime(e.at))}</th><td>${esc(e.message)}${e.source ? ` <span class="muted">${esc(e.source)}</span>` : ''}</td></tr>`)
          .join('')}</table></div>`
      : ''
  }
${
    calls.length
      ? `<h2>API &amp; bridge gần nhất (${x.callList.length}${x.callList.length > calls.length ? `, hiện ${calls.length} cuối` : ''})</h2>
<div class="card"><table class="calls"><tr><th>Lúc</th><th>Lời gọi</th><th>Kết quả</th><th>Thời gian</th></tr>${calls
          .map(
            (c) =>
              `<tr class="${callFailed(c) ? 'bad' : ''}"><td>${esc(fmtTime(c.startedAt))}</td><td>${esc(callLabel(c))}${c.page ? ` <span class="muted">· ${esc(c.page)}</span>` : ''}</td><td>${esc(callStatus(c))}</td><td>${c.durationMs ?? ''}${c.durationMs !== undefined ? ' ms' : ''}</td></tr>`
          )
          .join('')}</table><p class="muted">Chi tiết đầy đủ (header, body): api.har — mở bằng Chrome DevTools → Network → Import HAR; calls.json cho lệnh bridge.</p></div>`
      : ''
  }
<h2>Logcat ${x.appLines.length ? `của app (${x.appLines.length} dòng${x.appLines.length > log.length ? `, hiện ${log.length} cuối` : ''})` : '(toàn máy, 300 dòng cuối)'}</h2>
<div class="log">${log.map((l) => `<div class="${logClass(l)}">${esc(l)}</div>`).join('')}</div>
<p class="muted">Logcat đầy đủ của cả máy: logcat.txt</p>
</main></body></html>`
}
