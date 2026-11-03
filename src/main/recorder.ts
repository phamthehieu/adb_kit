import type { ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { adb, adbSpawn } from './adb'

/**
 * Records the device screen with `screenrecord` while a test runs. screenrecord stops
 * by itself after 3 minutes, so recording continues in consecutive segments.
 * `--bugreport` stamps the time on every frame (handy to line up with logs) and keeps
 * frames coming even when the screen is static.
 */
export class ScreenRecorder {
  private proc: ChildProcess | null = null
  private stopping = false
  private remote: string[] = []
  private useBugreport = true
  private exited: Promise<void> = Promise.resolve()

  constructor(
    private readonly serial: string,
    private readonly dir: string,
    private readonly tag = Math.random().toString(36).slice(2, 8)
  ) {}

  start(): void {
    this.next()
  }

  private next(): void {
    const file = `/sdcard/adbkit_rec_${this.tag}_${this.remote.length}.mp4`
    this.remote.push(file)
    const started = Date.now()
    const args = ['-s', this.serial, 'shell', 'screenrecord', '--bit-rate', '4000000']
    if (this.useBugreport) args.push('--bugreport')
    args.push(file)
    const proc = adbSpawn(args)
    this.proc = proc
    this.exited = new Promise((resolve) => {
      proc.on('exit', (code) => {
        resolve()
        if (this.stopping) return
        // Older devices reject --bugreport: retry once without it.
        if (this.useBugreport && code !== 0 && Date.now() - started < 2000) {
          this.useBugreport = false
          this.remote.pop()
          this.next()
          return
        }
        this.next() // 3-minute limit reached: start the next segment
      })
    })
  }

  /** Stops recording, downloads the segments into `dir` and returns their file names. */
  async stop(): Promise<string[]> {
    if (!this.proc) return []
    this.stopping = true
    // SIGINT makes screenrecord finalize the MP4 properly.
    await adb(['-s', this.serial, 'shell', 'pkill', '-INT', '-f', `adbkit_rec_${this.tag}`])
    await Promise.race([this.exited, new Promise((r) => setTimeout(r, 8000))])
    const out: string[] = []
    for (let i = 0; i < this.remote.length; i++) {
      const name = this.remote.length > 1 ? `video_${i + 1}.mp4` : 'video.mp4'
      const local = join(this.dir, name)
      await adb(['-s', this.serial, 'pull', this.remote[i], local], 120_000)
      await adb(['-s', this.serial, 'shell', 'rm', '-f', this.remote[i]])
      if (existsSync(local) && statSync(local).size > 0) out.push(name)
    }
    return out
  }
}
