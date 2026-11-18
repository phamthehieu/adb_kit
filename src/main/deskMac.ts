// "Bảng theo dõi" on macOS: network speed, battery, GPU load and the track that is playing, read
// with tools every Mac has (netstat, pmset, ioreg, osascript). Read-only, except for the media
// buttons, which are sent to the player that is shown.
//
// macOS has no public "what is playing" for every app, so the track comes from the two players
// that can be asked: Spotify (the desktop app) and Music. Music played in a browser tab is not
// seen. The first time, macOS asks the user to let ADB Kit control that player.
import { execFile } from 'node:child_process'
import { parseIoregGpu, parseMacMedia, parseNetstatIb, parsePmsetBatt, type Media, type SysSample } from '../shared/desk'

export type MacPlayer = 'Spotify' | 'Music'
const PLAYERS: { app: MacPlayer; unit: 's' | 'ms' }[] = [
  { app: 'Spotify', unit: 'ms' },
  { app: 'Music', unit: 's' }
]

/** Output of a command, or '' when it is missing, fails or takes too long. */
function run(cmd: string, args: string[], timeout = 4000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

/** True when the app is open. Asked with pgrep so that a player that is not installed is never looked up by AppleScript. */
const running = async (app: MacPlayer): Promise<boolean> => (await run('/usr/bin/pgrep', ['-x', app])).trim() !== ''

const nowPlayingScript = (app: MacPlayer): string[] => [
  `tell application "${app}"`,
  'if player state is stopped then return ""',
  'set t to current track',
  'set a to ""',
  'try',
  'set a to artist of t',
  'end try',
  'return (name of t) & tab & a & tab & ((player state is playing) as text) & tab & (player position as text) & tab & ((duration of t) as text)',
  'end tell'
]

const osa = (lines: string[]): Promise<string> => run('/usr/bin/osascript', lines.flatMap((l) => ['-e', l]))

/** The track of the first player that is playing; otherwise the first one that is paused. */
async function nowPlaying(): Promise<{ media: Media; app: MacPlayer } | undefined> {
  let paused: { media: Media; app: MacPlayer } | undefined
  for (const p of PLAYERS) {
    if (!(await running(p.app))) continue
    const media = parseMacMedia(await osa(nowPlayingScript(p.app)), p.unit)
    if (!media) continue
    if (media.playing) return { media, app: p.app }
    paused ??= { media, app: p.app }
  }
  return paused
}

export interface MacSample extends SysSample {
  /** The player `media` came from: the one the buttons go to. */
  player?: MacPlayer
}

/** One reading of everything. */
export async function readMac(): Promise<MacSample> {
  const [net, batt, gpu, np] = await Promise.all([
    run('/usr/sbin/netstat', ['-ib']),
    run('/usr/bin/pmset', ['-g', 'batt']),
    run('/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']),
    nowPlaying().catch(() => undefined)
  ])
  return {
    net: parseNetstatIb(net) ?? undefined,
    battery: parsePmsetBatt(batt),
    gpu: parseIoregGpu(gpu),
    media: np?.media,
    player: np?.app
  }
}

const COMMAND = { prev: 'previous track', toggle: 'playpause', next: 'next track' } as const

/** Press a button of that player, then say what it plays now. */
export async function macMedia(app: MacPlayer, action: keyof typeof COMMAND): Promise<Media | undefined> {
  const unit = PLAYERS.find((p) => p.app === app)!.unit
  await osa([`tell application "${app}" to ${COMMAND[action]}`])
  await new Promise((r) => setTimeout(r, 250)) // the player needs a moment to report its new state
  return parseMacMedia(await osa(nowPlayingScript(app)), unit)
}
