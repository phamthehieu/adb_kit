import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { esc } from './report'

/**
 * Results over time: every run that left a report.json (single runs, suite cases, several phones)
 * grouped by script — pass rate, last results as a strip, duration trend, and "flaky" scripts
 * (both passed and failed recently). Writes xu-huong.html in the reports folder.
 */

interface Run {
  script: string
  app: string
  version: string
  device: string
  result: string
  started: number
  ms: number
  failedStep?: string
  dir: string
}

function collect(root: string, depth = 0, out: Run[] = []): Run[] {
  if (depth > 2 || !existsSync(root)) return out
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const dir = join(root, e.name)
    const f = join(dir, 'report.json')
    if (existsSync(f)) {
      try {
        const r = JSON.parse(readFileSync(f, 'utf8'))
        const failed = (r.results ?? []).find((x: { state: string }) => x.state === 'failed')
        out.push({
          script: r.script?.name ?? '?',
          app: r.script?.app ?? '',
          version: r.appVersion ?? '',
          device: r.device ? `${r.device.model}` : r.serial,
          result: r.result,
          started: new Date(r.started).getTime(),
          ms: new Date(r.finished).getTime() - new Date(r.started).getTime(),
          failedStep: failed ? `${failed.text}: ${failed.message ?? ''}` : undefined,
          dir
        })
      } catch {
        /* unreadable report */
      }
    } else collect(dir, depth + 1, out)
  }
  return out
}

export function writeTrends(reportsRoot: string, days = 30): string {
  const since = Date.now() - days * 86_400_000
  const runs = collect(reportsRoot).filter((r) => r.started >= since && r.result !== 'stopped')
  const by = new Map<string, Run[]>()
  for (const r of runs) {
    const k = `${r.script}|${r.app}`
    by.set(k, [...(by.get(k) ?? []), r])
  }
  const rows = [...by.values()]
    .map((list) => {
      list.sort((a, b) => a.started - b.started)
      const pass = list.filter((r) => r.result === 'passed').length
      const recent = list.slice(-10)
      const flaky = recent.some((r) => r.result === 'passed') && recent.some((r) => r.result !== 'passed')
      // Flips between consecutive recent runs: many flips = unstable test, one flip = real change.
      const flips = recent.slice(1).filter((r, i) => (r.result === 'passed') !== (recent[i].result === 'passed')).length
      return { list, pass, flaky: flaky && flips >= 2, rate: pass / list.length }
    })
    .sort((a, b) => Number(b.flaky) - Number(a.flaky) || a.rate - b.rate)

  const strip = (list: Run[]): string =>
    list
      .slice(-20)
      .map(
        (r) =>
          `<a class="dot ${r.result === 'passed' ? 'p' : r.result === 'crashed' ? 'c' : 'f'}" href="file:///${join(r.dir, 'report.html').replace(/\\/g, '/')}" title="${esc(
            `${new Date(r.started).toLocaleString('vi-VN')} · ${r.device}${r.version ? ` · v${r.version}` : ''} · ${r.result}${r.failedStep ? `\n${r.failedStep}` : ''}`
          )}"></a>`
      )
      .join('')
  const sec = (ms: number): string => `${(ms / 1000).toFixed(0)} s`
  const flakyN = rows.filter((r) => r.flaky).length
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Xu hướng kết quả test</title>
<style>body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1c2330}main{max-width:1200px;margin:0 auto;padding:24px}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3e6eb;border-radius:10px;overflow:hidden}th,td{padding:7px 10px;border-bottom:1px solid #eef0f3;text-align:left;vertical-align:middle}thead th{background:#fafbfc}
.dot{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:3px}.dot.p{background:#1f9d55}.dot.f{background:#d64545}.dot.c{background:#7a1010}
.tag{font-size:11px;border-radius:8px;padding:1px 7px;background:#fff3d6;color:#8a5a00}.muted{color:#6b7280}.bar{height:6px;background:#eef0f3;border-radius:3px;width:120px;overflow:hidden}.bar>div{height:100%;background:#1f9d55}
.cards{display:flex;gap:12px;margin:14px 0 18px}.card{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:10px 16px}.card b{font-size:20px;display:block}</style></head>
<body><main><h1 style="margin:0">Xu hướng kết quả test</h1><div class="muted">${days} ngày gần nhất · ${runs.length} lần chạy · ${rows.length} kịch bản · tạo lúc ${new Date().toLocaleString('vi-VN')}</div>
<div class="cards"><div class="card"><span class="muted">Tỉ lệ đạt chung</span><b>${runs.length ? Math.round((runs.filter((r) => r.result === 'passed').length / runs.length) * 100) : 0}%</b></div>
<div class="card"><span class="muted">Test chập chờn (flaky)</span><b style="color:${flakyN ? '#b7791f' : '#1f9d55'}">${flakyN}</b></div>
<div class="card"><span class="muted">Kịch bản luôn lỗi</span><b style="color:${rows.some((r) => r.pass === 0) ? '#d64545' : '#1f9d55'}">${rows.filter((r) => r.pass === 0).length}</b></div></div>
${
    rows.length
      ? `<table><thead><tr><th>Kịch bản</th><th>Đạt</th><th>20 lần gần nhất (cũ → mới)</th><th>Thời gian (gần nhất)</th><th>Lỗi gần nhất</th></tr></thead><tbody>${rows
          .map(({ list, pass, flaky, rate }) => {
            const last = list[list.length - 1]
            const lastFail = [...list].reverse().find((r) => r.result !== 'passed')
            return `<tr><td><b>${esc(list[0].script)}</b>${flaky ? ' <span class="tag">chập chờn</span>' : ''}<div class="muted">${esc(list[0].app || '')}</div></td>
<td>${pass}/${list.length}<div class="bar"><div style="width:${Math.round(rate * 100)}%"></div></div></td><td>${strip(list)}</td><td>${sec(last.ms)}</td>
<td class="muted">${lastFail ? `${new Date(lastFail.started).toLocaleDateString('vi-VN')} — ${esc((lastFail.failedStep ?? lastFail.result).slice(0, 120))}` : '—'}</td></tr>`
          })
          .join('')}</tbody></table>`
      : '<p class="muted">Chưa có lần chạy nào có report.json (báo cáo tạo từ bản ADB Kit này trở đi).</p>'
  }
<p class="muted">"Chập chờn" = trong 10 lần gần nhất vừa có đạt vừa có lỗi và đổi qua lại ít nhất 2 lần — thường do chờ chưa đủ, dữ liệu server thay đổi, hoặc popup lúc có lúc không. Bấm vào ô màu để mở báo cáo của lần đó.</p>
</main></body></html>`
  const file = join(reportsRoot, 'xu-huong.html')
  writeFileSync(file, html)
  return file
}

export const reportsExist = (root: string): boolean => existsSync(root) && statSync(root).isDirectory()
