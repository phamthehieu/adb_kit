/**
 * Plays the phone's sound: raw 48 kHz, 16-bit little-endian, stereo PCM from scrcpy-server.
 * Chunks are scheduled back to back on a Web Audio clock; if playback falls behind, the
 * schedule is reset so the sound never drifts further and further from the picture.
 */
export class AudioPlayer {
  private readonly ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  private next = 0

  constructor() {
    void this.ctx.resume()
  }

  push(pcm: Uint8Array): void {
    const frames = pcm.byteLength >> 2 // 2 channels x 2 bytes
    if (!frames) return
    const view = new DataView(pcm.buffer, pcm.byteOffset, frames * 4)
    const buf = this.ctx.createBuffer(2, frames, 48000)
    const left = buf.getChannelData(0)
    const right = buf.getChannelData(1)
    for (let i = 0; i < frames; i++) {
      left[i] = view.getInt16(i * 4, true) / 32768
      right[i] = view.getInt16(i * 4 + 2, true) / 32768
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)
    const now = this.ctx.currentTime
    if (this.next < now + 0.02 || this.next > now + 0.4) this.next = now + 0.06 // (re)start with a small cushion
    src.start(this.next)
    this.next += buf.duration
  }

  dispose(): void {
    void this.ctx.close()
  }
}
