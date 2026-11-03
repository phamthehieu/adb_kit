import { q, shell } from './adb'

export interface PerfSample {
  /** ms since the run started. */
  t: number
  step: number
  memMb?: number
  /** Percent of one CPU core used by the app since the previous sample. */
  cpu?: number
}

export interface FrameStats {
  frames: number
  janky: number
  jankPct: number
  p50?: number
  p90?: number
  p95?: number
  p99?: number
}

export interface StartupRecord {
  step: number
  ms: number
  /** Process was not running before the launch. */
  cold: boolean
}

/** `dumpsys gfxinfo <pkg>` → frame statistics since the last reset. */
export async function frameStats(serial: string, pkg: string): Promise<FrameStats | null> {
  const r = await shell(serial, `dumpsys gfxinfo ${q(pkg)}`)
  const num = (re: RegExp): number | undefined => {
    const m = re.exec(r.stdout)
    return m ? Number(m[1]) : undefined
  }
  const frames = num(/Total frames rendered:\s*(\d+)/)
  if (frames === undefined) return null
  const janky = num(/Janky frames:\s*(\d+)/) ?? 0
  return {
    frames,
    janky,
    jankPct: frames ? Math.round((janky / frames) * 1000) / 10 : 0,
    p50: num(/50th percentile:\s*(\d+)ms/),
    p90: num(/90th percentile:\s*(\d+)ms/),
    p95: num(/95th percentile:\s*(\d+)ms/),
    p99: num(/99th percentile:\s*(\d+)ms/)
  }
}

/**
 * Launch the app's launcher activity with `am start -W` and return the measured
 * TotalTime (ms). Null when the activity can't be resolved (caller falls back to monkey).
 */
export async function launchTimed(serial: string, pkg: string): Promise<{ ms: number; cold: boolean } | null> {
  const act = (await shell(serial, `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${q(pkg)} | tail -n 1`)).stdout.trim()
  if (!/^[\w.]+\/[\w.$]+$/.test(act)) return null
  const wasRunning = !!(await shell(serial, `pidof ${q(pkg)}`)).stdout.trim()
  const r = await shell(serial, `am start -W -n ${q(act)}`, 60_000)
  const m = /TotalTime:\s*(\d+)/.exec(r.stdout) ?? /WaitTime:\s*(\d+)/.exec(r.stdout)
  if (!m || /Error/.test(r.stdout + r.stderr)) return null
  return { ms: Number(m[1]), cold: !wasRunning }
}

/** Samples the app's memory (PSS) and CPU every couple of seconds during a run. */
export class PerfMonitor {
  readonly samples: PerfSample[] = []
  readonly startups: StartupRecord[] = []
  private timer: NodeJS.Timeout | null = null
  private last: { pid: string; ticks: number; at: number } | null = null
  private busy = false
  private readonly t0 = Date.now()

  constructor(
    private readonly serial: string,
    private readonly pkg: string,
    private readonly getStep: () => number
  ) {}

  async start(): Promise<void> {
    // Frame statistics then cover exactly this run.
    await shell(this.serial, `dumpsys gfxinfo ${q(this.pkg)} reset`).catch(() => {})
    void this.sample()
    this.timer = setInterval(() => void this.sample(), 2000)
  }

  /** Take one sample now (also used by "perf" checks to get a fresh value). */
  async sample(): Promise<PerfSample | null> {
    if (this.busy) return null
    this.busy = true
    try {
      const pkg = q(this.pkg)
      const r = await shell(
        this.serial,
        `p=$(pidof ${pkg} | cut -d' ' -f1); if [ -n "$p" ]; then echo PID $p; cat /proc/$p/stat; dumpsys meminfo ${pkg} | grep -m1 -E 'TOTAL( PSS)?:'; fi`
      )
      const pid = /^PID (\d+)/m.exec(r.stdout)?.[1]
      if (!pid) {
        this.last = null
        return null
      }
      const s: PerfSample = { t: Date.now() - this.t0, step: this.getStep() }
      const mem = /TOTAL(?: PSS)?:\s+(\d+)/.exec(r.stdout)
      if (mem) s.memMb = Math.round(Number(mem[1]) / 102.4) / 10
      // /proc/<pid>/stat: fields after "(comm)": state is #3, utime #14, stime #15 (clock ticks, 100/s).
      const stat = /\)\s+(.*)$/m.exec(r.stdout.split('\n').find((l) => l.startsWith(pid + ' ')) ?? '')
      if (stat) {
        const f = stat[1].trim().split(/\s+/)
        const ticks = Number(f[11]) + Number(f[12])
        const now = Date.now()
        if (this.last && this.last.pid === pid && now > this.last.at) {
          s.cpu = Math.max(0, Math.round(((ticks - this.last.ticks) / 100 / ((now - this.last.at) / 1000)) * 1000) / 10)
        }
        this.last = { pid, ticks, at: now }
      }
      this.samples.push(s)
      return s
    } catch {
      return null
    } finally {
      this.busy = false
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
