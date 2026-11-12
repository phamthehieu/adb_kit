import type { VideoPacket } from '@shared/types'
import { Msg, simple } from './control'

/** Find the SPS NAL unit in an Annex-B buffer and build an `avc1.PPCCLL` codec string. */
function codecFromConfig(config: Uint8Array): string {
  for (let i = 0; i + 4 < config.length; i++) {
    const sc3 = config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 1
    if (!sc3) continue
    const nal = i + 3
    if ((config[nal] & 0x1f) === 7) {
      const hex = (n: number): string => n.toString(16).padStart(2, '0')
      return `avc1.${hex(config[nal + 1])}${hex(config[nal + 2])}${hex(config[nal + 3])}`
    }
  }
  return 'avc1.42e01f' // baseline 3.1 fallback
}

/** HEVC: Main profile, level 5.1 — the decoder only needs a plausible profile for Annex-B input. */
const HEVC_CODEC = 'hev1.1.6.L153.B0'

/**
 * Decodes the scrcpy H.264 (or opt-in H.265) stream with WebCodecs (hardware accelerated) and paints
 * every decoded frame onto a canvas immediately, for minimal latency.
 */
export class H264Player {
  private decoder: VideoDecoder | null = null
  private config: Uint8Array | null = null
  private pendingConfig = false
  private waitingKey = true
  private ctx: CanvasRenderingContext2D
  /** Size of the device stream in pixels; touch coordinates must use this. */
  width = 0
  height = 0
  fps = 0
  private frames = 0
  private fpsTimer: number

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSize: (w: number, h: number) => void,
    private readonly onFirstFrame: () => void,
    private readonly codecKind: 'h264' | 'h265' = 'h264',
    /** Called when this PC cannot decode the chosen codec. */
    private readonly onUnsupported: () => void = () => {}
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
    this.fpsTimer = window.setInterval(() => {
      this.fps = this.frames
      this.frames = 0
    }, 1000)
  }

  push(p: VideoPacket): void {
    if (p.kind === 'session') {
      this.width = p.width
      this.height = p.height
      this.onSize(p.width, p.height)
      return
    }
    if (p.kind === 'config') {
      this.config = p.data
      this.pendingConfig = true
      this.configure(this.codecString(p.data))
      return
    }
    if (!this.decoder || this.decoder.state !== 'configured') {
      this.requestKeyFrame() // e.g. stream started while the screen was off
      return
    }
    if (this.waitingKey && !p.key) {
      this.requestKeyFrame()
      return
    }
    let data = p.data
    if (this.pendingConfig && this.config) {
      // WebCodecs in Annex-B mode wants SPS/PPS in-band with the first key frame.
      const merged = new Uint8Array(this.config.length + data.length)
      merged.set(this.config)
      merged.set(data, this.config.length)
      data = merged
      this.pendingConfig = false
    }
    this.waitingKey = false
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: p.pts, data }))
    } catch {
      this.waitingKey = true
    }
  }

  /** True once at least one real video frame has been painted. */
  hasVideo = false

  /** Paint a still image (e.g. a screencap) until the first video frame arrives. */
  showStill(img: ImageBitmap): void {
    if (this.hasVideo) return
    const w = this.width || img.width
    const h = this.height || img.height
    this.canvas.width = w
    this.canvas.height = h
    this.ctx.drawImage(img, 0, 0, w, h)
  }

  private lastReset = 0
  /** Ask scrcpy-server to restart the encoder (=> new config + key frame), at most every 2s. */
  private requestKeyFrame(): void {
    const now = performance.now()
    if (now - this.lastReset < 2000) return
    this.lastReset = now
    window.api.mirror.control(simple(Msg.ResetVideo))
  }

  private codecString(config: Uint8Array): string {
    return this.codecKind === 'h265' ? HEVC_CODEC : codecFromConfig(config)
  }

  private configure(codec: string): void {
    this.decoder?.close()
    let first = true
    const decoder = new VideoDecoder({
      output: (frame) => {
        const w = frame.displayWidth
        const h = frame.displayHeight
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w
          this.canvas.height = h
        }
        this.ctx.drawImage(frame, 0, 0)
        frame.close()
        this.hasVideo = true
        this.frames++
        if (first) {
          first = false
          this.onFirstFrame()
        }
      },
      error: (e) => {
        console.warn('decoder error', e)
        this.waitingKey = true
        this.pendingConfig = true
        if (this.config) queueMicrotask(() => this.configure(this.codecString(this.config!)))
        // Ask the server for a fresh key frame instead of waiting for the next periodic one.
        this.requestKeyFrame()
      }
    })
    // No `description` => bitstream is Annex-B, which is what scrcpy sends.
    const cfg = { codec, optimizeForLatency: true, hardwareAcceleration: 'no-preference' } as VideoDecoderConfig
    if (this.codecKind === 'h265') (cfg as unknown as { hevc: { format: string } }).hevc = { format: 'annexb' }
    if (this.codecKind === 'h265') {
      void VideoDecoder.isConfigSupported(cfg).then((r) => {
        if (!r.supported) this.onUnsupported()
      })
    }
    decoder.configure(cfg)
    this.decoder = decoder
    this.waitingKey = true
  }

  dispose(): void {
    clearInterval(this.fpsTimer)
    try {
      this.decoder?.close()
    } catch {
      /* already closed */
    }
    this.decoder = null
  }
}
