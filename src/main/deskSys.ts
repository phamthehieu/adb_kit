// What Node cannot read by itself for "Bảng theo dõi": network speed, GPU load, battery and the
// track that is playing. On Windows one small PowerShell helper (resources/desk-helper.ps1)
// prints these every two seconds; on Linux the network counters and battery come from /proc and
// /sys. Everything is read-only, and anything a platform cannot give is simply left out.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { netRate, parseProcNetDev, parseSysLine, type Battery, type NetCounters, type NetRate, type SysSample } from '../shared/desk'

/** A sample older than this is not shown (the helper died or is stuck). */
const STALE_MS = 10_000

async function linuxBattery(): Promise<Battery | undefined> {
  const base = '/sys/class/power_supply'
  try {
    for (const n of await readdir(base)) {
      if (!n.startsWith('BAT')) continue
      const level = Number((await readFile(join(base, n, 'capacity'), 'utf8')).trim())
      const status = (await readFile(join(base, n, 'status'), 'utf8')).trim()
      if (Number.isFinite(level)) return { level: Math.min(100, Math.max(0, level)), charging: status !== 'Discharging' }
    }
  } catch {
    /* no battery */
  }
  return undefined
}

export class SysWatcher {
  private child: ChildProcess | null = null
  private timer: NodeJS.Timeout | null = null
  private sample: SysSample = {}
  private at = 0
  private lastNet: { c: NetCounters; t: number } | null = null
  private rate: NetRate | undefined

  constructor(private helper: string) {}

  start(): void {
    this.stop()
    if (process.platform === 'win32') {
      if (!this.helper || !existsSync(this.helper)) return
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.helper, '-ParentId', String(process.pid)], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      this.child = child
      let buf = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        buf += chunk
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const s = parseSysLine(buf.slice(0, nl))
          buf = buf.slice(nl + 1)
          if (s) this.take(s)
        }
        if (buf.length > 65536) buf = ''
      })
      child.on('error', () => {})
      child.on('exit', () => {
        if (this.child === child) this.child = null
      })
    } else if (process.platform === 'linux') {
      const tick = async (): Promise<void> => {
        const s: SysSample = {}
        try {
          s.net = parseProcNetDev(await readFile('/proc/net/dev', 'utf8')) ?? undefined
        } catch {
          /* no /proc */
        }
        s.battery = await linuxBattery()
        this.take(s)
      }
      void tick()
      this.timer = setInterval(() => void tick(), 2000)
    }
  }

  private take(s: SysSample): void {
    const now = Date.now()
    if (s.net) {
      this.rate = this.lastNet ? netRate(this.lastNet.c, s.net, now - this.lastNet.t) : undefined
      this.lastNet = { c: s.net, t: now }
    } else {
      this.rate = undefined
      this.lastNet = null
    }
    this.sample = s
    this.at = now
  }

  /** The latest reading, or nothing when it is too old to trust. */
  latest(now = Date.now()): { net?: NetRate; gpu?: SysSample['gpu']; battery?: Battery; media?: SysSample['media'] } {
    if (now - this.at > STALE_MS) return {}
    return { net: this.rate, gpu: this.sample.gpu, battery: this.sample.battery, media: this.sample.media }
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.sample = {}
    this.at = 0
    this.lastNet = null
    this.rate = undefined
  }
}
