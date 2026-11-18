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
/** How long the last track stays on screen after the player stops reporting one. */
const MEDIA_GRACE_MS = 6000

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
  private mediaAt = 0
  private lastNet: { c: NetCounters; t: number } | null = null
  private rate: NetRate | undefined

  constructor(private helper: string) {}

  start(): void {
    this.stop()
    if (process.platform === 'win32') {
      if (!this.helper || !existsSync(this.helper)) return
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.helper, '-ParentId', String(process.pid)], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore']
      })
      this.child = child
      child.stdin?.on('error', () => {})
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

  /**
   * Ask the helper to press a media button on the player it is showing. False when there is no
   * helper to ask (the caller then falls back to a media key).
   */
  media(action: MediaAction): boolean {
    const stdin = this.child?.stdin
    if (!stdin || !stdin.writable) return false
    stdin.write(action + '\n')
    return true
  }

  private take(s: SysSample): void {
    const now = Date.now()
    // Between two tracks the player reports nothing for a moment: keep showing the last track
    // instead of hiding the tile and bringing it back.
    if (s.media) this.mediaAt = now
    else if (this.sample.media && now - this.mediaAt < MEDIA_GRACE_MS) s.media = this.sample.media
    if (s.mediaOnly) {
      this.sample = { ...this.sample, media: s.media }
      this.at = now
      return
    }
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
    this.mediaAt = 0
    this.lastNet = null
    this.rate = undefined
  }
}

export type MediaAction = 'prev' | 'toggle' | 'next'

const WIN_MEDIA_VK: Record<MediaAction, number> = {
  prev: 0xb1, // VK_MEDIA_PREV_TRACK
  toggle: 0xb3, // VK_MEDIA_PLAY_PAUSE
  next: 0xb0 // VK_MEDIA_NEXT_TRACK
}

/**
 * Press a system media key on the host PC. Fallback for when the helper is not running: it starts
 * a new PowerShell each time (slow) and cannot tell which player gets the key.
 */
export function sendMediaKey(action: MediaAction): void {
  if (process.platform === 'win32') {
    const vk = WIN_MEDIA_VK[action]
    const ps = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class MK { [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, int f, int e); }'; [MK]::keybd_event(${vk},0,1,0); [MK]::keybd_event(${vk},0,3,0)`
    const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      stdio: 'ignore'
    })
    c.on('error', () => {})
  } else if (process.platform === 'linux') {
    const cmd = action === 'prev' ? 'previous' : action === 'next' ? 'next' : 'play-pause'
    const c = spawn('playerctl', [cmd], { stdio: 'ignore' })
    c.on('error', () => {})
  }
}
