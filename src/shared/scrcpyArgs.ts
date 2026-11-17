import type { MirrorOptions } from './types'

/** What the client must do to match the arguments given to scrcpy-server. */
export interface ScrcpyPlan {
  /** key=value arguments, in the order they are put on the command line. */
  args: string[]
  /** The server waits for exactly these sockets, in this order, before it sends anything useful. */
  sockets: Array<'video' | 'audio' | 'control'>
}

export const isCameraSource = (o: Pick<MirrorOptions, 'source'>): boolean => o.source === 'camera-back' || o.source === 'camera-front'

/**
 * Builds the scrcpy-server arguments and the matching socket list from one place, so the two
 * can never disagree.
 *
 * Rules learnt the hard way:
 * - `audio`, `control` and `clipboard_autosync` default to TRUE on the server. They are always
 *   sent explicitly: if `audio` is left out the server waits for an audio socket the client
 *   never opens and the mirror hangs before the encoder starts.
 * - The default command line (no optional feature switched on) must stay byte-for-byte the
 *   known-good one. The Samsung S9 (Android 10) aborts its H.264 encoder (SIGABRT in
 *   ACodec::reconfigEncoder4OtherApps) when extra arguments are added; the working theory is a
 *   256-byte buffer for the process command line. Optional arguments are therefore appended
 *   only when switched on, and show_touches / power_off_on_close are never sent (done with adb).
 */
export function buildScrcpyPlan(scid: string, opts: MirrorOptions): ScrcpyPlan {
  const camera = isCameraSource(opts)
  const audio = opts.audio === true
  const args = [
    `scid=${scid}`,
    'log_level=info',
    'tunnel_forward=true',
    `audio=${audio}`,
    `control=${!camera}`,
    `video_codec=${opts.codec === 'h265' ? 'h265' : 'h264'}`,
    `max_size=${opts.maxSize}`,
    `video_bit_rate=${opts.bitRate}`,
    `max_fps=${opts.maxFps}`,
    'stay_awake=true',
    `clipboard_autosync=${opts.clipboardSync === true}`
  ]
  if (audio) args.push('audio_codec=raw') // 48 kHz s16le stereo: no audio decoder needed on the PC
  if (audio && camera) args.push('audio_source=mic') // "output" capture does not apply to a camera
  if (camera) args.push('video_source=camera', `camera_facing=${opts.source === 'camera-front' ? 'front' : 'back'}`)

  const sockets: ScrcpyPlan['sockets'] = ['video']
  if (audio) sockets.push('audio')
  if (!camera) sockets.push('control')
  return { args, sockets }
}

/**
 * Length in bytes of the server process command line as the phone sees it in
 * /proc/<pid>/cmdline (every argument followed by a NUL).
 */
export function scrcpyCmdlineBytes(version: string, args: string[]): number {
  const argv = ['app_process', '/', 'com.genymobile.scrcpy.Server', version, ...args]
  const enc = new TextEncoder()
  return argv.reduce((n, a) => n + enc.encode(a).length + 1, 0)
}
