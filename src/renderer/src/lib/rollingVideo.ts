/**
 * Always-on "replay buffer" of the mirrored screen, for quick bug reports: records the mirror
 * canvas in back-to-back segments of SEGMENT_MS and keeps the last finished one plus the one in
 * progress, so a report always has the last 20–40 seconds. Low frame rate keeps CPU use small.
 * Nothing is written anywhere unless a report is made.
 */
const SEGMENT_MS = 20_000
const FPS = 8
const BITRATE = 1_500_000

let canvas: HTMLCanvasElement | null = null
let stream: MediaStream | null = null
let current: { rec: MediaRecorder; chunks: Blob[]; startedAt: number } | null = null
let previous: { blob: Blob; startedAt: number; endedAt: number } | null = null
let timer = 0
let enabled = localStorage.getItem('bugVideo') !== '0'

const mime = (): string =>
  ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? ''

function begin(): void {
  if (!stream) return
  const chunks: Blob[] = []
  const rec = new MediaRecorder(stream, { mimeType: mime(), videoBitsPerSecond: BITRATE })
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(1000)
  current = { rec, chunks, startedAt: Date.now() }
}

/** Stop the running segment and resolve with its video. */
function finish(seg: NonNullable<typeof current>): Promise<{ blob: Blob; startedAt: number; endedAt: number }> {
  return new Promise((resolve) => {
    const done = (): void => resolve({ blob: new Blob(seg.chunks, { type: 'video/webm' }), startedAt: seg.startedAt, endedAt: Date.now() })
    if (seg.rec.state === 'inactive') return done()
    seg.rec.onstop = done
    seg.rec.stop()
  })
}

async function rotate(): Promise<void> {
  const seg = current
  current = null
  if (seg) previous = await finish(seg)
  begin()
}

/** Start buffering the given canvas (called by the screen when mirroring starts). */
export function attachRolling(c: HTMLCanvasElement): void {
  detachRolling()
  canvas = c
  if (!enabled || typeof MediaRecorder === 'undefined') return
  stream = c.captureStream(FPS)
  begin()
  timer = window.setInterval(() => void rotate(), SEGMENT_MS)
}

export function detachRolling(): void {
  clearInterval(timer)
  timer = 0
  if (current && current.rec.state !== 'inactive') current.rec.stop()
  current = null
  previous = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

export const rollingEnabled = (): boolean => enabled

export function setRollingEnabled(on: boolean): void {
  enabled = on
  localStorage.setItem('bugVideo', on ? '1' : '0')
  const c = canvas
  if (on && c) attachRolling(c)
  else if (!on) {
    detachRolling()
    canvas = c
  }
}

/**
 * The last 20–40 s of the screen as one or two WebM clips (oldest first). Buffering goes on.
 * Clips shorter than a second (nothing happened on screen) are dropped.
 */
export async function grabRolling(): Promise<{ data: Uint8Array; startedAt: number; endedAt: number }[]> {
  if (!current) return []
  const seg = current
  current = null
  const last = await finish(seg)
  const prev = previous
  previous = last
  begin()
  clearInterval(timer)
  timer = window.setInterval(() => void rotate(), SEGMENT_MS)
  const clips = [prev, last].filter((c): c is NonNullable<typeof c> => !!c && c.blob.size > 2000 && c.endedAt - c.startedAt > 1000)
  return Promise.all(clips.map(async (c) => ({ data: new Uint8Array(await c.blob.arrayBuffer()), startedAt: c.startedAt, endedAt: c.endedAt })))
}
