import { describe, expect, it } from 'vitest'
import { buildScrcpyPlan, scrcpyCmdlineBytes } from '../scrcpyArgs'
import type { MirrorOptions } from '../types'

const base: MirrorOptions = { maxSize: 1280, bitRate: 8_000_000, maxFps: 120 }
const SCID = '12720897'

/** Every combination of the options that change the server command line. */
function allCombos(): MirrorOptions[] {
  const out: MirrorOptions[] = []
  for (const audio of [undefined, false, true])
    for (const clipboardSync of [undefined, false, true])
      for (const codec of [undefined, 'h264', 'h265'] as const)
        for (const source of [undefined, 'display', 'camera-back', 'camera-front'] as const)
          out.push({ ...base, audio, clipboardSync, codec, source, showTouches: true, powerOffOnClose: true })
  return out
}

describe('scrcpy-server command line', () => {
  it('default command line is byte-for-byte the known-good one (Samsung S9 encoder)', () => {
    expect(buildScrcpyPlan(SCID, base).args.join(' ')).toBe(
      'scid=12720897 log_level=info tunnel_forward=true audio=false control=true video_codec=h264 ' +
        'max_size=1280 video_bit_rate=8000000 max_fps=120 stay_awake=true clipboard_autosync=false'
    )
  })

  it('default command line stays under the 256 bytes the S9 encoder tolerates', () => {
    expect(scrcpyCmdlineBytes('5.0.1', buildScrcpyPlan(SCID, base).args)).toBeLessThan(256)
    // Options a tester can switch on for the S9 (Android 10: no camera) must fit too.
    const s9Worst: MirrorOptions = { maxSize: 1920, bitRate: 16_000_000, maxFps: 120, audio: true, clipboardSync: true, codec: 'h265' }
    expect(scrcpyCmdlineBytes('5.0.1', buildScrcpyPlan(SCID, s9Worst).args)).toBeLessThan(256)
  })

  it('always states audio, control and clipboard_autosync (they default to true on the server)', () => {
    for (const o of allCombos()) {
      const { args } = buildScrcpyPlan(SCID, o)
      for (const key of ['audio', 'control', 'clipboard_autosync']) {
        const hits = args.filter((a) => a.startsWith(key + '='))
        expect(hits, `${key} in ${args.join(' ')}`).toHaveLength(1)
        expect(hits[0]).toMatch(/=(true|false)$/)
      }
    }
  })

  it('opens exactly the sockets the server will wait for, in server order', () => {
    for (const o of allCombos()) {
      const { args, sockets } = buildScrcpyPlan(SCID, o)
      const expected = ['video', ...(args.includes('audio=true') ? ['audio'] : []), ...(args.includes('control=true') ? ['control'] : [])]
      expect(sockets, args.join(' ')).toEqual(expected)
    }
  })

  it('never sends the arguments that crashed the S9 encoder', () => {
    for (const o of allCombos()) {
      const line = buildScrcpyPlan(SCID, o).args.join(' ')
      expect(line).not.toMatch(/show_touches|power_off_on_close/)
    }
  })

  it('has no empty, spaced or duplicated arguments (the line is passed through adb shell)', () => {
    for (const o of allCombos()) {
      const { args } = buildScrcpyPlan(SCID, o)
      for (const a of args) expect(a).toMatch(/^[a-z_]+=[A-Za-z0-9_.-]+$/)
      const keys = args.map((a) => a.split('=')[0])
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('camera: no control socket, camera arguments present, microphone as audio source', () => {
    const { args, sockets } = buildScrcpyPlan(SCID, { ...base, source: 'camera-front', audio: true })
    expect(args).toContain('control=false')
    expect(args).toContain('video_source=camera')
    expect(args).toContain('camera_facing=front')
    expect(args).toContain('audio_source=mic')
    expect(sockets).toEqual(['video', 'audio'])
  })
})
