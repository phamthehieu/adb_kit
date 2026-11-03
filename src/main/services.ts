import type { ChildProcess } from 'node:child_process'
import { adb, adbSpawn, q, shell } from './adb'
import type { CmdResult, FileEntry, InstallFlags } from '../shared/types'

/* ------------------------------------------------------------------ logcat */

export class LogcatStream {
  private proc: ChildProcess | null = null
  private pending: string[] = []
  private partial = ''
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly onLines: (lines: string[]) => void) {}

  start(serial: string): void {
    this.stop()
    // -T: start with the last N lines, then follow.
    const proc = adbSpawn(['-s', serial, 'logcat', '-v', 'threadtime', '-T', '3000'])
    this.proc = proc
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      const text = this.partial + chunk
      const lines = text.split(/\r?\n/)
      this.partial = lines.pop() ?? ''
      for (const l of lines) if (l && !l.startsWith('---------')) this.pending.push(l)
    })
    // Batch to ~10 IPC messages per second regardless of log volume.
    this.timer = setInterval(() => {
      if (this.pending.length) {
        const batch = this.pending
        this.pending = []
        this.onLines(batch)
      }
    }, 100)
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.pending = []
    this.partial = ''
  }
}

/* ------------------------------------------------------------------- shell */

export class ShellSession {
  private proc: ChildProcess | null = null

  constructor(
    private readonly onData: (data: string) => void,
    private readonly onExit: (code: number | null) => void
  ) {}

  start(serial: string, cols: number, rows: number): void {
    this.stop()
    // -tt forces a remote PTY so we get a prompt, echo and job control.
    const proc = adbSpawn(['-s', serial, 'shell', '-tt', `stty cols ${cols} rows ${rows} 2>/dev/null; exec /system/bin/sh -l`])
    this.proc = proc
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', this.onData)
    proc.stderr?.on('data', this.onData)
    proc.on('exit', (code) => {
      if (this.proc === proc) {
        this.proc = null
        this.onExit(code)
      }
    })
  }

  write(data: string): void {
    // adb.exe reads a piped stdin in text mode and drops lone CRs, so send Enter as LF;
    // the remote PTY turns it back into a normal newline.
    this.proc?.stdin?.write(process.platform === 'win32' ? data.replace(/\r/g, '\n') : data)
  }

  stop(): void {
    const p = this.proc
    this.proc = null
    p?.kill()
  }
}

/* ------------------------------------------------------------------- files */

// toybox `ls -la` line, e.g.
// drwxrwx--x  4 root sdcard_rw  4096 2026-11-02 08:29 Download
// lrw-r--r--  1 root root         11 2009-01-01 08:00 sdcard -> /storage/self/primary
// crw-rw-rw-  1 root root      1,   3 2026-11-02 08:00 null
const LS_RE = /^([-dlcbps])([-rwxsStT]{9})\S*\s+\d+\s+(\S+)\s+(\S+)\s+(\d+|\d+,\s*\d+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d)\s(.*)$/

export async function listDir(serial: string, path: string): Promise<{ entries: FileEntry[]; error?: string }> {
  const dir = path.endsWith('/') ? path : path + '/'
  const r = await shell(serial, `ls -la ${q(dir)}`)
  const entries: FileEntry[] = []
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = LS_RE.exec(line)
    if (!m) continue
    const [, t, perms, owner, , size, date, rawName] = m
    let name = rawName
    let linkTarget: string | undefined
    if (t === 'l') {
      const i = rawName.indexOf(' -> ')
      if (i >= 0) {
        name = rawName.slice(0, i)
        linkTarget = rawName.slice(i + 4)
      }
    }
    if (name === '.' || name === '..') continue
    entries.push({
      name,
      type: t === 'd' ? 'dir' : t === 'l' ? 'link' : t === '-' ? 'file' : 'other',
      size: /^\d+$/.test(size) ? Number(size) : 0,
      date,
      perms: t + perms,
      owner,
      linkTarget
    })
  }
  entries.sort((a, b) => {
    const da = a.type === 'dir' || a.type === 'link' ? 0 : 1
    const db = b.type === 'dir' || b.type === 'link' ? 0 : 1
    return da - db || a.name.localeCompare(b.name)
  })
  const err = (r.stderr || (r.code !== 0 ? r.stdout : '')).trim()
  return { entries, error: entries.length === 0 && err ? err : undefined }
}

const result = (r: { code: number; stdout: string; stderr: string }): CmdResult => ({
  ok: r.code === 0 && !/error|failed|failure/i.test(r.stdout.split('\n').pop() ?? ''),
  output: (r.stdout + r.stderr).trim()
})

export async function pull(serial: string, remote: string, local: string): Promise<CmdResult> {
  return result(await adb(['-s', serial, 'pull', '-a', remote, local], 30 * 60_000))
}

export async function push(serial: string, locals: string[], remoteDir: string): Promise<CmdResult> {
  return result(await adb(['-s', serial, 'push', ...locals, remoteDir.endsWith('/') ? remoteDir : remoteDir + '/'], 30 * 60_000))
}

export async function removePath(serial: string, path: string): Promise<CmdResult> {
  return result(await shell(serial, `rm -rf ${q(path)}`))
}

export async function makeDir(serial: string, path: string): Promise<CmdResult> {
  return result(await shell(serial, `mkdir -p ${q(path)}`))
}

/* ----------------------------------------------------------------- install */

export async function installApk(serial: string, apk: string, f: InstallFlags): Promise<CmdResult> {
  const args = ['-s', serial, 'install']
  if (f.replace) args.push('-r')
  if (f.downgrade) args.push('-d')
  if (f.grant) args.push('-g')
  if (f.test) args.push('-t')
  args.push(apk)
  const r = await adb(args, 10 * 60_000)
  const out = (r.stdout + r.stderr).trim()
  return { ok: r.code === 0 && /Success/.test(out), output: out }
}

/* -------------------------------------------------------------------- apps */

export async function listPackages(serial: string): Promise<string[]> {
  const r = await shell(serial, 'pm list packages')
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/^package:/, '').trim())
    .filter(Boolean)
    .sort()
}

/** All packages plus which ones the user installed (pm -3), for sorting in pickers. */
export async function packageCatalog(serial: string): Promise<{ all: string[]; user: string[] }> {
  const [all, user] = await Promise.all([listPackages(serial), shell(serial, 'pm list packages -3')])
  const u = user.stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/^package:/, '').trim())
    .filter(Boolean)
    .sort()
  return { all, user: u }
}

/** Package of the app currently in front (null on lock screen / launcher-less states). */
export async function foregroundPackage(serial: string): Promise<string | null> {
  const r = await shell(serial, 'dumpsys window | grep -E "mFocusedApp|mCurrentFocus"')
  const m = /ActivityRecord\{\S+ u\d+ ([\w.]+)\//.exec(r.stdout) ?? /Window\{\S+ u\d+ ([\w.]+)\//.exec(r.stdout)
  return m ? m[1] : null
}

export async function pidsOf(serial: string, pkg: string): Promise<number[]> {
  // Include the app's secondary processes too (e.g. "com.foo:remote").
  const r = await shell(serial, 'ps -A -o PID,NAME')
  const pids: number[] = []
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line)
    if (m && (m[2] === pkg || m[2].startsWith(pkg + ':'))) pids.push(Number(m[1]))
  }
  return pids
}
