/** One reading of the app under test, taken every second or so by the "Hiệu năng" panel. */
export interface LiveSample {
  /** ms since the recording started. */
  t: number
  /** The app had a running process at this moment. */
  running: boolean
  /** App memory (PSS) in MB. */
  memMb?: number
  /** CPU used by the app, in % of ONE core (so 200 = two cores fully busy). */
  cpu?: number
  /** Frames the app drew per second since the previous reading (0 while the screen is still). */
  fps?: number
  /** Janky frames since the previous reading. */
  jank?: number
  /** Phone battery, %. */
  battery?: number
  /** Battery temperature, °C. */
  tempC?: number
}

export interface LiveMark {
  t: number
  text: string
}

/**
 * Plain-language remarks about a recording. Thresholds are deliberately conservative so that a
 * remark means "worth a look", never a verdict.
 */
export function liveRemarks(samples: LiveSample[]): string[] {
  const out: string[] = []
  const run = samples.filter((s) => s.running)
  if (run.length < 5) return out
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

  const mem = run.filter((s) => s.memMb !== undefined)
  if (mem.length >= 20) {
    const k = Math.max(5, Math.floor(mem.length / 5))
    const start = avg(mem.slice(0, k).map((s) => s.memMb!))
    const end = avg(mem.slice(-k).map((s) => s.memMb!))
    const mins = (mem[mem.length - 1].t - mem[0].t) / 60_000
    if (end - start >= 30 && end / start >= 1.2 && mins >= 0.5) out.push(`RAM tăng từ ${start.toFixed(0)} lên ${end.toFixed(0)} MB trong ${mins.toFixed(1)} phút — nếu bạn chỉ lặp lại cùng một thao tác thì nghi rò rỉ bộ nhớ.`)
  }
  const peak = mem.length ? Math.max(...mem.map((s) => s.memMb!)) : 0
  if (peak >= 500) out.push(`RAM đạt đỉnh ${peak.toFixed(0)} MB — máy RAM thấp có thể giết app.`)

  const fps = run.filter((s) => s.fps !== undefined && s.fps > 0)
  const frames = fps.reduce((a, s) => a + (s.fps ?? 0), 0)
  const jank = fps.reduce((a, s) => a + (s.jank ?? 0), 0)
  if (frames > 60 && jank / frames >= 0.1) out.push(`${Math.round((jank / frames) * 100)}% khung hình bị giật — nên xem lại màn hình bạn vừa thao tác.`)

  const cpu = run.filter((s) => s.cpu !== undefined).map((s) => s.cpu!)
  if (cpu.length >= 8) {
    let streak = 0
    let best = 0
    for (const c of cpu) {
      streak = c >= 80 ? streak + 1 : 0
      best = Math.max(best, streak)
    }
    if (best >= 8) out.push(`CPU ở mức cao (≥ 80% một lõi) liên tục khoảng ${best} giây — kiểm tra vòng lặp, animation hoặc polling.`)
  }

  const tmp = samples.filter((s) => s.tempC !== undefined)
  if (tmp.length >= 5) {
    const rise = tmp[tmp.length - 1].tempC! - tmp[0].tempC!
    if (rise >= 3) out.push(`Pin nóng lên ${rise.toFixed(1)}°C trong lúc đo.`)
  }
  return out
}
