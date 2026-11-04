import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { adb, adbBinary, deviceDetails, q, shell } from './adb'
import { MANUAL_LABEL, type EvidenceInput, type EvidenceResult } from '../shared/manual'

/**
 * Evidence for manual test results: when a tester marks a KBKT test case Đạt / Lỗi / Xem xét,
 * save the screen, the app and phone identity, and for failures the log and the last seconds of
 * video — in a folder the KBKT cell links to, so nobody has to attach files by hand.
 */

const safe = (s: string, max = 60): string => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'x'
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Folder name of a KBKT file inside the evidence root. */
export const kbktFolder = (file: string): string => safe(basename(file, extname(file)), 80)

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

const COLOR: Record<string, string> = { P: '#3ddc84', F: '#ff7b7b', PE: '#f5c35c' }

function page(i: EvidenceInput, meta: Record<string, string>, files: { shot: string; log?: string; videos: string[] }): string {
  const rows = Object.entries(meta)
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('')
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(i.code)} — ${esc(MANUAL_LABEL[i.result])}</title>
<style>
body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;background:#0f1216;color:#e3e8ef;margin:0;padding:24px;max-width:980px}
h1{font-size:20px;margin:0 0 4px}.tag{display:inline-block;padding:2px 12px;border-radius:99px;font-weight:700;color:#0a0c0f;background:${COLOR[i.result]}}
.muted{color:#a3acba}pre{white-space:pre-wrap;background:#151920;border:1px solid #262d38;border-radius:8px;padding:12px}
table{border-collapse:collapse;margin:12px 0}th{text-align:left;color:#a3acba;padding:3px 16px 3px 0;font-weight:500}
img{max-width:360px;border-radius:12px;border:1px solid #364050}video{max-width:360px;border-radius:12px;margin-right:8px}a{color:#5aa9ff}
</style></head><body>
<h1>${esc(i.code || `Dòng ${i.row}`)} <span class="tag">${esc(MANUAL_LABEL[i.result])}</span></h1>
<p class="muted">${esc(i.sheet)} · ${esc(i.purpose)}</p>
<h3>Các bước</h3><pre>${esc(i.steps)}</pre>
<h3>Kết quả mong muốn</h3><pre>${esc(i.expected)}</pre>
${i.note ? `<h3>Ghi chú của tester</h3><pre>${esc(i.note)}</pre>` : ''}
<h3>Môi trường</h3><table>${rows}</table>
<h3>Bằng chứng</h3>
<p><img src="${esc(files.shot)}" alt="Ảnh màn hình lúc chấm"></p>
${files.videos.map((v) => `<video src="${esc(v)}" controls></video>`).join('')}
<p>${files.log ? `<a href="${esc(files.log)}">logcat.txt</a> · ` : ''}<a href="info.json">info.json</a></p>
</body></html>`
}

/** Save the evidence for one result. Throws (with a readable message) if the phone cannot be read. */
export async function captureEvidence(serial: string, root: string, i: EvidenceInput): Promise<EvidenceResult> {
  const at = new Date()
  const stamp = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(root, kbktFolder(i.kbkt), safe(i.code || `dong${i.row}`), `${stamp}_${i.result}`)

  const wantLog = i.result !== 'P' && i.withLog
  const [png, fg, act, device] = await Promise.all([
    adbBinary(['-s', serial, 'exec-out', 'screencap', '-p'], 30_000).catch((e: Error) => {
      throw new Error(`Không chụp được màn hình điện thoại: ${e.message}`)
    }),
    shell(serial, 'dumpsys window | grep -E "mFocusedApp|mCurrentFocus"'),
    shell(serial, 'dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -1'),
    deviceDetails(serial).catch(() => null)
  ])
  if (png.length < 100 || !png.subarray(0, 4).equals(PNG)) throw new Error('Điện thoại không trả về ảnh màn hình (màn hình đang tắt hoặc bị khóa?)')
  const pkg = (/ActivityRecord\{\S+ u\d+ ([\w.]+)\//.exec(fg.stdout) ?? /Window\{\S+ u\d+ ([\w.]+)\//.exec(fg.stdout))?.[1] ?? ''
  const activity = /\{\S+ u\d+ (\S+)/.exec(act.stdout)?.[1] ?? ''
  const ver = pkg ? /versionName=(\S+)/.exec((await shell(serial, `dumpsys package ${q(pkg)} | grep -m1 versionName`)).stdout)?.[1] ?? '' : ''

  mkdirSync(dir, { recursive: true })
  const files = ['screenshot.png']
  writeFileSync(join(dir, 'screenshot.png'), png)

  let log: string | undefined
  if (wantLog) {
    const [main, crash] = await Promise.all([
      adb(['-s', serial, 'logcat', '-d', '-v', 'threadtime', '-t', '4000'], 20_000),
      adb(['-s', serial, 'logcat', '-d', '-b', 'crash', '-v', 'threadtime', '-t', '300'], 10_000)
    ])
    const crashText = crash.stdout.trim()
    writeFileSync(join(dir, 'logcat.txt'), (crashText ? `===== CRASH BUFFER =====\n${crashText}\n\n===== LOGCAT (4000 dòng cuối) =====\n` : '') + main.stdout)
    log = 'logcat.txt'
    files.push(log)
  }

  const videos: string[] = []
  ;(i.videos ?? []).forEach((v, k) => {
    const name = `video-${k + 1}.webm`
    writeFileSync(join(dir, name), Buffer.from(v.data))
    videos.push(name)
    files.push(name)
  })

  const meta: Record<string, string> = {
    'Thời điểm': at.toLocaleString('vi-VN'),
    'Điện thoại': device ? `${device.manufacturer} ${device.model}` : serial,
    Android: device ? `${device.android} (API ${device.sdk})` : '',
    'Màn hình': device?.screen ?? '',
    'App đang mở': pkg,
    'Phiên bản app': ver,
    'Màn hình app': activity,
    'File KBKT': basename(i.kbkt)
  }
  writeFileSync(join(dir, 'info.json'), JSON.stringify({ ...meta, result: i.result, code: i.code, sheet: i.sheet, row: i.row, purpose: i.purpose, note: i.note, serial }, null, 2))
  files.push('info.json')
  const html = join(dir, 'index.html')
  writeFileSync(html, page(i, meta, { shot: 'screenshot.png', log, videos }))
  files.push('index.html')
  return { dir, html, files }
}
