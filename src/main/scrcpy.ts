import { EventEmitter } from 'node:events'
import { Socket, connect } from 'node:net'
import type { ChildProcess } from 'node:child_process'
import { adb, adbSpawn } from './adb'
import type { MirrorOptions, VideoPacket } from '../shared/types'

/** Must match the bundled resources/scrcpy-server exactly (server checks it). */
export const SCRCPY_VERSION = '5.0.1'
const REMOTE_JAR = '/data/local/tmp/adbkit-scrcpy-server.jar'

const FLAG_SESSION = 1n << 63n
const FLAG_CONFIG = 1n << 62n
const FLAG_KEY = 1n << 61n
const PTS_MASK = FLAG_KEY - 1n

/**
 * Accumulates bytes from a socket and lets an async reader pull exact lengths.
 */
class ByteReader {
  private chunks: Buffer[] = []
  private length = 0
  private waiter: (() => void) | null = null
  private ended = false

  constructor(sock: Socket) {
    sock.on('data', (b: Buffer) => {
      this.chunks.push(b)
      this.length += b.length
      this.wake()
    })
    sock.on('close', () => {
      this.ended = true
      this.wake()
    })
    sock.on('error', () => {})
  }

  private wake(): void {
    const w = this.waiter
    this.waiter = null
    w?.()
  }

  async read(n: number): Promise<Buffer> {
    while (this.length < n) {
      if (this.ended) throw new Error('stream closed')
      await new Promise<void>((r) => (this.waiter = r))
    }
    if (this.chunks[0].length < n) this.chunks = [Buffer.concat(this.chunks)]
    const first = this.chunks[0]
    const out = first.subarray(0, n)
    if (first.length === n) this.chunks.shift()
    else this.chunks[0] = first.subarray(n)
    this.length -= n
    return out
  }
}

function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect({ host: '127.0.0.1', port }, () => resolve(s))
    s.once('error', reject)
    s.setNoDelay(true)
  })
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const t0 = Date.now()
function dbg(msg: string): void {
  if (process.env.ADBKIT_DEBUG) console.log(`[scrcpy +${Date.now() - t0}ms] ${msg}`)
}

export interface ScrcpyEvents {
  video: [VideoPacket]
  ready: [string]
  closed: [string | null]
  /** Text the phone's clipboard changed to (only when clipboard sync is on). */
  clipboard: [string]
}

/**
 * One mirroring session against one device using scrcpy-server in "tunnel forward" mode.
 * The PC connects to the device: first socket = video, second = control.
 */
export class ScrcpySession extends EventEmitter<ScrcpyEvents> {
  private proc: ChildProcess | null = null
  private video: Socket | null = null
  private control: Socket | null = null
  private port = 0
  private closed = false
  private serverLog = ''
  /** Current video size; injected touch coordinates must be expressed in it. */
  width = 0
  height = 0

  constructor(
    readonly serial: string,
    private readonly jarPath: string,
    private readonly opts: MirrorOptions
  ) {
    super()
  }

  /**
   * Removes `adb forward`s left behind by sessions that were killed without cleanup
   * (their device-side scrcpy socket no longer exists). Live sessions — including other
   * ADB Kit windows — keep a listening socket and are left alone.
   */
  private static async cleanStaleForwards(serial: string): Promise<void> {
    const list = await adb(['forward', '--list'])
    const ours = [...list.stdout.matchAll(/^(\S+) (tcp:\d+) localabstract:(scrcpy_[0-9a-f]+)$/gm)].filter((m) => m[1] === serial)
    if (!ours.length) return
    const unix = await adb(['-s', serial, 'shell', 'cat /proc/net/unix'])
    const live = new Set([...unix.stdout.matchAll(/@(scrcpy_[0-9a-f]+)/g)].map((m) => m[1]))
    for (const m of ours) if (!live.has(m[3])) await adb(['-s', serial, 'forward', '--remove', m[2]])
  }

  async start(): Promise<void> {
    const s = this.serial
    await ScrcpySession.cleanStaleForwards(s).catch(() => {})
    dbg('start ' + s)
    const push = await adb(['-s', s, 'push', this.jarPath, REMOTE_JAR], 60_000)
    if (push.code !== 0) throw new Error(`push scrcpy-server failed: ${push.stderr || push.stdout}`)
    this.assertOpen()
    dbg('pushed server')

    const scid = (Math.floor(Math.random() * 0x7fffffff) >>> 0).toString(16).padStart(8, '0')
    const fwd = await adb(['-s', s, 'forward', 'tcp:0', `localabstract:scrcpy_${scid}`])
    this.port = parseInt(fwd.stdout.trim(), 10)
    if (fwd.code !== 0 || !this.port) throw new Error(`adb forward failed: ${fwd.stderr}`)
    if (this.closed) {
      void adb(['-s', s, 'forward', '--remove', `tcp:${this.port}`])
      throw new Error('cancelled')
    }

    const args = [
      `scid=${scid}`,
      'log_level=info',
      'tunnel_forward=true',
      'audio=false',
      'control=true',
      'video_codec=h264',
      `max_size=${this.opts.maxSize}`,
      `video_bit_rate=${this.opts.bitRate}`,
      `max_fps=${this.opts.maxFps}`,
      'stay_awake=true',
      `clipboard_autosync=${this.opts.clipboardSync === true}`
    ]
    // Do NOT add show_touches / power_off_on_close here: on the Samsung S9 (Android 10) they
    // made the H.264 encoder abort (SIGABRT in ACodec::reconfigEncoder4OtherApps) every time.
    this.proc = adbSpawn([
      '-s', s, 'shell',
      `CLASSPATH=${REMOTE_JAR} app_process / com.genymobile.scrcpy.Server ${SCRCPY_VERSION} ${args.join(' ')}`
    ])
    dbg('server spawned')
    const collect = (b: Buffer): void => {
      dbg('server: ' + b.toString().trim())
      this.serverLog = (this.serverLog + b.toString()).slice(-4000)
    }
    this.proc.stdout?.on('data', collect)
    this.proc.stderr?.on('data', collect)
    this.proc.on('exit', () => this.close(this.closed ? null : `scrcpy server exited\n${this.serverLog.trim()}`))

    // The adb forward accepts immediately even before the server listens, so retry
    // until we actually receive the dummy byte on the video socket.
    let reader: ByteReader | null = null
    const deadline = Date.now() + 15_000
    while (!this.closed && Date.now() < deadline) {
      let sock: Socket | null = null
      try {
        sock = await openSocket(this.port)
        const r = new ByteReader(sock)
        // Dummy byte; a connection that stays silent is treated as "not listening yet".
        await Promise.race([r.read(1), delay(2000).then(() => Promise.reject(new Error('timeout')))])
        this.video = sock
        reader = r
        break
      } catch (e) {
        sock?.destroy()
        dbg(`video connect retry: ${(e as Error).message}`)
        await delay(100)
      }
    }
    dbg('video socket connected')
    if (!reader || !this.video) {
      const msg = `could not connect to scrcpy server\n${this.serverLog.trim()}`
      this.close(msg)
      throw new Error(msg)
    }

    this.control = await openSocket(this.port)
    this.control.on('error', () => {})
    void this.readDeviceMessages(new ByteReader(this.control))

    const nameBuf = await reader.read(64)
    const deviceName = nameBuf.subarray(0, Math.max(0, nameBuf.indexOf(0))).toString('utf8') || s
    const codecId = (await reader.read(4)).readUInt32BE(0)
    if (codecId === 0 || codecId === 1) throw new Error(`device disabled the video stream\n${this.serverLog}`)

    dbg('ready ' + deviceName)
    this.emit('ready', deviceName)
    void this.pump(reader)
  }

  /** Device → client messages on the control socket: 0 = clipboard, 1 = clipboard ack, 2 = UHID output. */
  private async readDeviceMessages(r: ByteReader): Promise<void> {
    try {
      while (!this.closed) {
        const type = (await r.read(1))[0]
        if (type === 0) {
          const len = (await r.read(4)).readUInt32BE(0)
          // An absurd size means framing was lost; stop rather than allocate.
          if (len > 4 * 1024 * 1024) throw new Error('clipboard message too large')
          this.emit('clipboard', (await r.read(len)).toString('utf8'))
        } else if (type === 1) {
          await r.read(8)
        } else if (type === 2) {
          const h = await r.read(4)
          await r.read(h.readUInt16BE(2))
        } else {
          throw new Error('unknown device message ' + type)
        }
      }
    } catch {
      /* Framing lost: keep draining so the device never blocks on a full control socket. */
      this.control?.on('data', () => {})
    }
  }

  private async pump(reader: ByteReader): Promise<void> {
    try {
      while (!this.closed) {
        const header = await reader.read(12)
        const ptsFlags = header.readBigUInt64BE(0)
        if (ptsFlags & FLAG_SESSION) {
          this.width = header.readUInt32BE(4)
          this.height = header.readUInt32BE(8)
          this.emit('video', { kind: 'session', width: this.width, height: this.height })
          continue
        }
        const size = header.readUInt32BE(8)
        const data = await reader.read(size)
        if (ptsFlags & FLAG_CONFIG) {
          this.emit('video', { kind: 'config', data: new Uint8Array(data) })
        } else {
          this.emit('video', {
            kind: 'frame',
            key: (ptsFlags & FLAG_KEY) !== 0n,
            pts: Number(ptsFlags & PTS_MASK),
            data: new Uint8Array(data)
          })
        }
      }
    } catch (e) {
      this.close(this.closed ? null : `video stream ended: ${(e as Error).message}`)
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('cancelled')
  }

  sendControl(bytes: Uint8Array): void {
    if (this.control && !this.control.destroyed) this.control.write(bytes)
  }

  get isOpen(): boolean {
    return !this.closed && !!this.control && this.width > 0
  }

  close(reason: string | null = null): void {
    if (this.closed) return
    this.closed = true
    this.video?.destroy()
    this.control?.destroy()
    this.proc?.kill()
    if (this.port) void adb(['-s', this.serial, 'forward', '--remove', `tcp:${this.port}`])
    this.emit('closed', reason)
  }
}
