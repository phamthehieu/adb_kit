import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DeviceDetails, DeviceInfo } from '../shared/types'

const EXE = process.platform === 'win32' ? 'adb.exe' : 'adb'

/** Folder where ADB Kit keeps its own copy of platform-tools (set by main at startup). */
let ownToolsDir = ''

function locateAdb(): string {
  const candidates = [
    process.env.ADB_PATH,
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', EXE),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, 'platform-tools', EXE),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', EXE),
    ownToolsDir && join(ownToolsDir, 'platform-tools', EXE)
  ]
  for (const c of candidates) if (c && existsSync(c)) return c
  return EXE // fall back to PATH lookup
}

let ADB = locateAdb()

/** Path of the adb binary in use. */
export const adbPath = (): string => ADB

/** Tell adb.ts where ADB Kit's own platform-tools copy lives, and re-resolve. */
export function setOwnToolsDir(dir: string): void {
  ownToolsDir = dir
  ADB = locateAdb()
}

/**
 * Download Google's official platform-tools (≈7 MB) into ADB Kit's data folder, for
 * testers who don't have the Android SDK. Returns the new adb path.
 */
export async function installPlatformTools(): Promise<string> {
  if (!ownToolsDir) throw new Error('chưa đặt thư mục dữ liệu')
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const res = await fetch(`https://dl.google.com/android/repository/platform-tools-latest-${os}.zip`)
  if (!res.ok) throw new Error(`Tải thất bại: HTTP ${res.status}`)
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()))
  const { mkdirSync, writeFileSync, chmodSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('platform-tools/')) continue
    const out = join(ownToolsDir, name)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, await entry.async('nodebuffer'))
    if (process.platform !== 'win32' && /\/(adb|fastboot)$/.test(name)) chmodSync(out, 0o755)
  }
  ADB = locateAdb()
  if (!existsSync(ADB)) throw new Error('Đã tải nhưng không thấy adb trong gói')
  return ADB
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Run adb and collect text output. Never rejects; inspect `code`. */
export function adb(args: string[], timeoutMs = 30_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      ADB,
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() || (err && !stderr ? err.message : '') })
      }
    )
  })
}

/** Run adb and collect binary stdout (e.g. exec-out screencap). */
export function adbBinary(args: string[], timeoutMs = 30_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      ADB,
      args,
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.toString() || err.message))
        else resolve(stdout)
      }
    )
  })
}

export function adbSpawn(args: string[], opts: SpawnOptions = {}): ChildProcess {
  return spawn(ADB, args, { windowsHide: true, ...opts })
}

/** Run a shell command on a device; returns stdout (stderr appended on failure). */
export async function shell(serial: string, command: string, timeoutMs?: number): Promise<RunResult> {
  return adb(['-s', serial, 'shell', command], timeoutMs)
}

/** Quote a value for the Android (mksh/toybox) shell. */
export function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export async function adbVersion(): Promise<string> {
  const r = await adb(['version'])
  const m = /Version ([\w.-]+)/.exec(r.stdout)
  return m ? m[1] : r.code === 0 ? 'unknown' : 'not found'
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const r = await adb(['devices', '-l'], 10_000)
  const out: DeviceInfo[] = []
  for (const line of r.stdout.split(/\r?\n/).slice(1)) {
    const m = /^(\S+)\s+(\S+)(.*)$/.exec(line.trim())
    if (!m) continue
    const [, serial, state, rest] = m
    const prop = (k: string): string | undefined => new RegExp(`${k}:(\\S+)`).exec(rest)?.[1]
    const isWifi = /^[\d.]+:\d+$/.test(serial) || serial.includes('._adb-tls-connect.')
    out.push({
      serial,
      state,
      model: (prop('model') ?? serial).replace(/_/g, '-'),
      product: prop('product'),
      transport: isWifi ? 'wifi' : 'usb'
    })
  }
  return out
}

export async function deviceDetails(serial: string): Promise<DeviceDetails> {
  const sep = '@@'
  const cmd = [
    'getprop ro.product.manufacturer',
    'getprop ro.product.model',
    'getprop ro.build.version.release',
    'getprop ro.build.version.sdk',
    'getprop ro.product.cpu.abi',
    "dumpsys battery | grep -m1 level | tr -d ' '",
    'wm size | tail -n1'
  ].join(`; echo ${sep}; `)
  const r = await shell(serial, cmd)
  const p = r.stdout.split(sep).map((s) => s.trim())
  return {
    manufacturer: p[0] ?? '',
    model: p[1] ?? '',
    android: p[2] ?? '',
    sdk: p[3] ?? '',
    abi: p[4] ?? '',
    battery: (p[5] ?? '').replace('level:', '') + '%',
    screen: (p[6] ?? '').split(':').pop()?.trim() ?? ''
  }
}
