import { q, shell } from './adb'
import type { LiveMark, LiveSample } from '../shared/perflive'

/**
 * One reading of an app's health, taken while the tester uses the phone: memory (PSS), CPU,
 * frames drawn / janky frames since the last reading, and the phone's battery. Everything is
 * read-only (`cat /proc`, `dumpsys`), so it is safe to leave running on any app.
 */

interface Prev {
  pid: string
  ticks: number
  frames: number
  janky: number
  at: number
}
const prev = new Map<string, Prev>()
const key = (serial: string, pkg: string): string => `${serial}|${pkg}`

const REMOTE = (pkg: string): string =>
  `p=$(pidof ${q(pkg)} | cut -d' ' -f1); echo PID $p; if [ -n "$p" ]; then cat /proc/$p/stat; dumpsys meminfo ${q(pkg)} | grep -m1 -E 'TOTAL( PSS)?:'; dumpsys gfxinfo ${q(pkg)} | grep -E 'Total frames rendered|Janky frames'; fi; dumpsys battery | grep -E '^ *(level|temperature):'`

/** Turn the raw output of REMOTE into a sample. Pure, so it can be tested without a phone. */
export function parseLive(out: string, last: Prev | undefined, now: number, t: number): { sample: LiveSample; next: Prev | undefined } {
  out = out.replace(/\r/g, '') // adb on Windows hands shell output back with CRLF line ends
  const sample: LiveSample = { t, running: false }
  const level = /^\s*level:\s*(\d+)/m.exec(out)?.[1]
  const temp = /^\s*temperature:\s*(-?\d+)/m.exec(out)?.[1]
  if (level) sample.battery = Number(level)
  if (temp) sample.tempC = Math.round(Number(temp)) / 10

  const pid = /^PID (\d+)/m.exec(out)?.[1]
  if (!pid) return { sample, next: undefined }
  sample.running = true

  const mem = /TOTAL(?: PSS)?:\s+(\d+)/.exec(out)
  if (mem) sample.memMb = Math.round(Number(mem[1]) / 102.4) / 10

  const frames = Number(/Total frames rendered:\s*(\d+)/.exec(out)?.[1] ?? NaN)
  const janky = Number(/Janky frames:\s*(\d+)/.exec(out)?.[1] ?? NaN)
  // /proc/<pid>/stat: after "(comm)" the state is field 3; utime is #14 and stime #15 (clock ticks, 100/s).
  const statLine = out.split('\n').find((l) => l.startsWith(pid + ' '))
  const rest = statLine ? /\)\s+(.*)$/.exec(statLine)?.[1] : undefined
  let ticks = NaN
  if (rest) {
    const f = rest.trim().split(/\s+/)
    ticks = Number(f[11]) + Number(f[12])
  }

  if (last && last.pid === pid && now > last.at) {
    const secs = (now - last.at) / 1000
    if (Number.isFinite(ticks) && Number.isFinite(last.ticks)) sample.cpu = Math.max(0, Math.round(((ticks - last.ticks) / 100 / secs) * 1000) / 10)
    if (Number.isFinite(frames) && frames >= last.frames) {
      sample.fps = Math.round(((frames - last.frames) / secs) * 10) / 10
      if (Number.isFinite(janky) && janky >= last.janky) sample.jank = janky - last.janky
    }
  }
  return { sample, next: { pid, ticks, frames, janky, at: now } }
}

/** `t0` = when the tester pressed Start, so the chart's time axis starts at 0. */
export async function liveSample(serial: string, pkg: string, t0: number): Promise<LiveSample> {
  const k = key(serial, pkg)
  const r = await shell(serial, REMOTE(pkg), 15_000)
  const now = Date.now()
  const { sample, next } = parseLive(r.stdout, prev.get(k), now, now - t0)
  if (next) prev.set(k, next)
  else prev.delete(k)
  return sample
}

export function liveReset(serial: string, pkg: string): void {
  prev.delete(key(serial, pkg))
}

/** CSV of a recording (opens in Excel). Times are seconds since Start. */
export function liveCsv(samples: LiveSample[], marks: LiveMark[]): string {
  const cell = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
  const rows = ['giay,ram_mb,cpu_phan_tram,khung_hinh_giay,khung_giat,pin_phan_tram,nhiet_do_c,ghi_chu']
  const marked = marks.map((m) => ({ ...m, used: false })).sort((a, b) => a.t - b.t)
  for (const s of samples) {
    // A mark lands on the first reading at or after it.
    const note = marked.filter((m) => m.t <= s.t && !m.used).map((m) => { m.used = true; return m.text }).join(' / ')
    rows.push([Math.round(s.t / 100) / 10, s.memMb, s.cpu, s.fps, s.jank, s.battery, s.tempC, `"${note.replace(/"/g, '""')}"`].map(cell).join(','))
  }
  return '﻿' + rows.join('\r\n')
}
