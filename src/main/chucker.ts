import { app } from 'electron'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type { NetCall } from '../shared/automation'
import { adbBinary, q, shell } from './adb'

/**
 * Reads the HTTP log of native Android apps that bundle Chucker (an OkHttp interceptor common
 * in debug/staging builds). Chucker stores every request in the app's private
 * databases/chucker.db; a debuggable app lets `run-as` copy it out. The copy is opened locally
 * with SQLite. Nothing is written to the device.
 */

const CLIP = 20_000
const clip = (s: string | null | undefined): string | undefined =>
  s == null || s === '' ? undefined : s.length > CLIP ? s.slice(0, CLIP) + `… (${s.length} ký tự)` : s

type Header = { name: string; value: string }
const headers = (s: string | null): Header[] | undefined => {
  if (!s) return undefined
  try {
    const v = JSON.parse(s) as Header[]
    return Array.isArray(v) ? v : undefined
  } catch {
    return undefined
  }
}

interface Row {
  id: number
  requestDate: number | null
  responseDate: number | null
  tookMs: number | null
  method: string | null
  url: string | null
  requestHeaders: string | null
  requestBody: string | null
  isRequestBodyEncoded: number
  responseCode: number | null
  error: string | null
  responseContentType: string | null
  responseHeaders: string | null
  responseBody: string | null
  isResponseBodyEncoded: number
}

export interface ChuckerHandlers {
  onCall: (c: NetCall) => void
  onInfo?: (msg: string) => void
}

let seq = 0

export class ChuckerWatcher {
  private timer: NodeJS.Timeout | null = null
  private busy: Promise<void> | null = null
  private stopped = false
  private dir: string
  /** host ms − device ms, so startedAt lines up with WebView calls and step times. */
  private offset = 0
  private sinceDev = 0
  private maxId = 0
  private pending = new Set<number>()
  private lastStat = ''
  private lastMainStat = ''
  private primed = false
  /** True once chucker.db was found and read. */
  active = false

  constructor(
    private serial: string,
    private pkg: string,
    private h: ChuckerHandlers,
    /** Only calls made after this host time (ms) are reported. */
    private sinceHost = Date.now()
  ) {
    this.dir = join(app.getPath('temp'), 'adbkit-chucker', `${process.pid}-${++seq}`)
  }

  /** Looks for chucker.db; resolves true when the app has one and polling started. */
  async start(): Promise<boolean> {
    const probe = await shell(this.serial, `run-as ${q(this.pkg)} ls databases/chucker.db`)
    if (probe.code !== 0 || !/chucker\.db/.test(probe.stdout) || /not|denied|unknown/i.test(probe.stdout + probe.stderr)) return false
    if (this.stopped) return false
    const t0 = Date.now()
    const dev = Number((await shell(this.serial, 'date +%s%3N')).stdout.trim())
    const t1 = Date.now()
    this.offset = Number.isFinite(dev) && dev > 1e12 ? Math.round((t0 + t1) / 2) - dev : 0
    this.sinceDev = this.sinceHost - this.offset
    mkdirSync(this.dir, { recursive: true })
    this.active = true
    this.h.onInfo?.('App native có Chucker — đang đọc API từ chucker.db của app')
    await this.flush()
    this.timer = setInterval(() => void this.flush().catch(() => {}), 1000)
    return true
  }

  /** Reads any new / finished calls now (also used by "Kiểm tra API" before giving up). */
  flush(): Promise<void> {
    if (!this.active || this.stopped) return Promise.resolve()
    if (!this.busy) {
      this.busy = this.poll()
        .catch(() => {
          /* copied mid-write or device busy — next tick retries */
        })
        .finally(() => (this.busy = null))
    }
    return this.busy
  }

  private async poll(): Promise<void> {
    const run = `run-as ${q(this.pkg)}`
    // Cheap change check first: size + mtime of the database and its write-ahead log.
    const st = await shell(this.serial, `${run} stat -c '%s %Y' databases/chucker.db databases/chucker.db-wal 2>/dev/null`)
    if (this.stopped) return
    const stat = st.stdout.trim()
    if (stat === this.lastStat && this.primed) return
    const mainStat = stat.split('\n')[0] ?? ''
    const main = join(this.dir, 'main.db')
    if (mainStat !== this.lastMainStat) {
      writeFileSync(main, await adbBinary(['-s', this.serial, 'exec-out', 'run-as', this.pkg, 'cat', 'databases/chucker.db'], 60_000))
      this.lastMainStat = mainStat
    }
    const wal = await adbBinary(['-s', this.serial, 'exec-out', 'run-as', this.pkg, 'cat', 'databases/chucker.db-wal'], 60_000).catch(
      () => Buffer.alloc(0)
    )
    if (this.stopped) return
    // Work on a fresh copy each time: SQLite folds the WAL into the file when it closes.
    const work = join(this.dir, 'work.db')
    rmSync(work + '-wal', { force: true })
    rmSync(work + '-shm', { force: true })
    copyFileSync(main, work)
    if (wal.length) writeFileSync(work + '-wal', wal)
    const db = new DatabaseSync(work)
    let rows: Row[]
    try {
      const cols =
        'id, requestDate, responseDate, tookMs, method, url, requestHeaders, requestBody, isRequestBodyEncoded, responseCode, error, ' +
        'responseContentType, responseHeaders, responseBody, isResponseBodyEncoded'
      const ids = [...this.pending]
      rows = db
        .prepare(
          `SELECT ${cols} FROM transactions WHERE (id > ? AND requestDate >= ?)${ids.length ? ` OR id IN (${ids.join(',')})` : ''} ORDER BY id`
        )
        .all(this.maxId, this.sinceDev) as unknown as Row[]
      if (!this.primed) {
        // Older calls (before sinceHost) are skipped from now on.
        const m = db.prepare('SELECT MAX(id) AS m FROM transactions').get() as { m: number | null }
        this.maxId = Math.max(this.maxId, m.m ?? 0)
      }
    } finally {
      db.close()
    }
    this.lastStat = stat
    this.primed = true
    for (const r of rows) {
      this.maxId = Math.max(this.maxId, r.id)
      const done = r.responseCode != null || !!r.error
      if (done) this.pending.delete(r.id)
      else this.pending.add(r.id)
      this.h.onCall(this.toCall(r))
    }
    // Rows deleted by Chucker's retention never finish — don't poll them forever.
    if (this.pending.size > 200) this.pending = new Set([...this.pending].slice(-200))
  }

  private toCall(r: Row): NetCall {
    const startedAt = (r.requestDate ?? 0) + this.offset
    const status = r.responseCode ?? (r.error ? 0 : undefined)
    return {
      id: `chk-${r.id}`,
      kind: 'http',
      source: 'chucker',
      method: r.method ?? 'GET',
      url: r.url ?? '',
      args: r.isRequestBodyEncoded ? '(dữ liệu nhị phân)' : clip(r.requestBody),
      status,
      error: r.error ?? undefined,
      result: r.isResponseBodyEncoded ? `(dữ liệu nhị phân${r.responseContentType ? ` — ${r.responseContentType}` : ''})` : clip(r.responseBody),
      resourceType: r.responseContentType ?? undefined,
      reqHeaders: headers(r.requestHeaders),
      resHeaders: headers(r.responseHeaders),
      startedAt,
      durationMs: r.tookMs ?? (r.responseDate && r.requestDate ? r.responseDate - r.requestDate : undefined)
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.busy?.catch(() => {})
    rmSync(this.dir, { recursive: true, force: true })
  }
}
