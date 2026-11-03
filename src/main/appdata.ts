import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { adb, adbBinary, q, shell } from './adb'
import type { DataFile, DataKind, DbResult, DbTable, MmkvEntry, PrefEntry } from '../shared/appdata'

/**
 * Look at — and for SharedPreferences, edit — a debuggable app's private data with `run-as`:
 * SharedPreferences XML, SQLite databases (read-only queries on a local copy) and MMKV files
 * (read-only, best-effort decoding). Lets dev / QA flip feature flags, switch environments or
 * drop a login token without rebuilding the app.
 */

const runAs = (serial: string, pkg: string, cmd: string, timeout?: number): ReturnType<typeof shell> =>
  shell(serial, `run-as ${q(pkg)} sh -c ${q(cmd)}`, timeout)

const safePath = (p: string): string => {
  if (!/^[\w./ -]+$/.test(p) || p.includes('..') || p.startsWith('/')) throw new Error('Đường dẫn không hợp lệ')
  return p
}

function notDebuggable(out: string): boolean {
  return /not debuggable|is unknown|Package .* is unknown|run-as: /i.test(out)
}

export async function listAppData(serial: string, pkg: string): Promise<DataFile[]> {
  const r = await runAs(serial, pkg, 'for d in shared_prefs databases files/mmkv mmkv; do [ -d "$d" ] && find "$d" -maxdepth 1 -type f -exec stat -c "%s %Y %n" {} \\; ; done; echo __END__')
  const out = r.stdout + r.stderr
  if (!out.includes('__END__') || notDebuggable(out)) throw new Error(/unknown/i.test(out) ? 'Không tìm thấy app trên máy' : 'App không phải bản debug — Android không cho đọc dữ liệu riêng (run-as bị chặn).')
  const files: DataFile[] = []
  for (const line of r.stdout.split('\n')) {
    const m = /^(\d+) (\d+) (.+)$/.exec(line.trim())
    if (!m) continue
    const path = m[3]
    if (/-(journal|wal|shm)$|\.(crc|lock|bak)$/.test(path)) continue
    const kind: DataKind = path.startsWith('shared_prefs/') && path.endsWith('.xml') ? 'prefs' : path.startsWith('databases/') ? 'db' : /mmkv\//.test(path) ? 'mmkv' : 'other'
    files.push({ path, kind, size: Number(m[1]), mtime: Number(m[2]) * 1000 })
  }
  const order: DataKind[] = ['prefs', 'db', 'mmkv', 'other']
  return files.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.path.localeCompare(b.path))
}

/* -------------------------------------------------------- SharedPreferences */

const unxml = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')
const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function parsePrefs(text: string): PrefEntry[] {
  const out: PrefEntry[] = []
  const re = /<(string|int|long|float|boolean|set)\s+name="([^"]*)"(?:\s+value="([^"]*)")?\s*(?:\/>|>([\s\S]*?)<\/\1>)/g
  for (const m of text.matchAll(re)) {
    const type = m[1] as PrefEntry['type']
    const name = unxml(m[2])
    if (type === 'set') {
      const items = [...(m[4] ?? '').matchAll(/<string>([\s\S]*?)<\/string>/g)].map((x) => unxml(x[1]))
      out.push({ type, name, value: items.join('\n') })
    } else out.push({ type, name, value: type === 'string' ? unxml(m[4] ?? '') : (m[3] ?? '') })
  }
  return out
}

export function buildPrefs(entries: PrefEntry[]): string {
  const lines = entries.map((e) => {
    const n = xml(e.name)
    if (e.type === 'string') return `    <string name="${n}">${xml(e.value)}</string>`
    if (e.type === 'set') {
      const items = e.value.split('\n').filter((x) => x !== '')
      return items.length ? `    <set name="${n}">\n${items.map((x) => `        <string>${xml(x)}</string>`).join('\n')}\n    </set>` : `    <set name="${n}" />`
    }
    return `    <${e.type} name="${n}" value="${xml(e.value)}" />`
  })
  return `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n${lines.join('\n')}\n</map>\n`
}

function validate(e: PrefEntry): void {
  if (!e.name) throw new Error('Thiếu tên khóa')
  if ((e.type === 'int' || e.type === 'long') && !/^-?\d+$/.test(e.value.trim())) throw new Error(`"${e.name}": cần số nguyên`)
  if (e.type === 'float' && !Number.isFinite(Number(e.value))) throw new Error(`"${e.name}": cần số`)
  if (e.type === 'boolean' && !/^(true|false)$/.test(e.value)) throw new Error(`"${e.name}": cần true / false`)
}

export async function readPrefs(serial: string, pkg: string, path: string): Promise<PrefEntry[]> {
  const r = await runAs(serial, pkg, `cat ${q(safePath(path))}`)
  if (notDebuggable(r.stdout + r.stderr)) throw new Error('Không đọc được file')
  return parsePrefs(r.stdout)
}

/**
 * Save SharedPreferences. The app is stopped first: a running app keeps its own copy in memory
 * and would overwrite the file. The file goes through /data/local/tmp because `run-as` can't
 * read the PC's data; it's deleted right after.
 */
export async function writePrefs(serial: string, pkg: string, path: string, entries: PrefEntry[]): Promise<void> {
  safePath(path)
  if (!path.startsWith('shared_prefs/') || !path.endsWith('.xml')) throw new Error('Chỉ sửa được file trong shared_prefs')
  entries.forEach(validate)
  const tmpLocal = join(app.getPath('temp'), `adbkit-prefs-${process.pid}.xml`)
  const tmpDev = `/data/local/tmp/adbkit_prefs_${Date.now()}.xml`
  writeFileSync(tmpLocal, buildPrefs(entries), 'utf8')
  try {
    await shell(serial, `am force-stop ${q(pkg)}`)
    const p = await adb(['-s', serial, 'push', tmpLocal, tmpDev])
    if (p.code !== 0) throw new Error(p.stderr.trim() || 'không chép được file lên máy')
    await shell(serial, `chmod 644 ${tmpDev}`)
    const w = await runAs(serial, pkg, `cat ${tmpDev} > ${q(path)} && rm -f ${q(path.replace(/\.xml$/, '.xml.bak'))} && echo ok`)
    if (!w.stdout.includes('ok')) throw new Error(w.stderr.trim() || w.stdout.trim() || 'không ghi được file')
  } finally {
    await shell(serial, `rm -f ${tmpDev}`)
    rmSync(tmpLocal, { force: true })
  }
}

/* ------------------------------------------------------------------ SQLite */

const dbCache = new Map<string, { at: number; file: string }>()

/** Copy a database (with its WAL, so recent writes are included) to a local temp folder. */
async function localDb(serial: string, pkg: string, path: string, fresh: boolean): Promise<string> {
  safePath(path)
  const key = `${serial}|${pkg}|${path}`
  const c = dbCache.get(key)
  if (c && !fresh && Date.now() - c.at < 60_000) return c.file
  const dir = join(app.getPath('temp'), 'adbkit-appdata', `${process.pid}`, String(dbCache.size))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'copy.db')
  rmSync(file, { force: true })
  rmSync(file + '-wal', { force: true })
  writeFileSync(file, await adbBinary(['-s', serial, 'exec-out', 'run-as', pkg, 'cat', path], 120_000))
  const wal = await adbBinary(['-s', serial, 'exec-out', 'run-as', pkg, 'cat', `${path}-wal`], 120_000).catch(() => Buffer.alloc(0))
  if (wal.length && !/No such file/.test(wal.subarray(0, 200).toString())) writeFileSync(file + '-wal', wal)
  dbCache.set(key, { at: Date.now(), file })
  return file
}

export async function dbTables(serial: string, pkg: string, path: string): Promise<DbTable[]> {
  const db = new DatabaseSync(await localDb(serial, pkg, path, true))
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
    return names.map(({ name }) => {
      let rows = -1
      try {
        rows = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number }).n)
      } catch {
        /* virtual table etc. */
      }
      return { name, rows }
    })
  } finally {
    db.close()
  }
}

/** Run a read-only query on the local copy (max 500 rows). */
export async function dbQuery(serial: string, pkg: string, path: string, sql: string): Promise<DbResult> {
  if (!/^\s*(select|with|pragma|explain)\b/i.test(sql) || /;\s*\S/.test(sql.trim().replace(/;\s*$/, ''))) {
    throw new Error('Chỉ chạy được một câu SELECT / WITH / PRAGMA (xem dữ liệu, không sửa)')
  }
  const db = new DatabaseSync(await localDb(serial, pkg, path, false))
  try {
    const st = db.prepare(sql)
    const rows: (string | number | null)[][] = []
    let columns: string[] = []
    let truncated = false
    for (const r of st.iterate() as Iterable<Record<string, unknown>>) {
      if (!columns.length) columns = Object.keys(r)
      if (rows.length >= 500) {
        truncated = true
        break
      }
      rows.push(
        columns.map((k) => {
          const v = r[k]
          if (v == null) return null
          if (typeof v === 'number' || typeof v === 'string') return typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}…` : v
          if (typeof v === 'bigint') return v.toString()
          if (v instanceof Uint8Array) return `[${v.length} byte]`
          return String(v)
        })
      )
    }
    if (!columns.length) columns = st.columns().map((c) => c.name)
    return { columns, rows, truncated }
  } finally {
    db.close()
  }
}

/* -------------------------------------------------------------------- MMKV */

function varint(b: Buffer, at: number): [number, number] {
  let v = 0
  let shift = 0
  let i = at
  while (i < b.length) {
    const byte = b[i++]
    v += (byte & 0x7f) * 2 ** shift
    if (!(byte & 0x80)) return [v, i]
    shift += 7
    if (shift > 49) break
  }
  return [-1, i]
}

const printable = (s: string): boolean => !/[\u0000-\u0008\u000e-\u001f�]/.test(s)

function guess(v: Buffer): { value: string; as: string } {
  // Strings are stored as varint length + UTF-8.
  const [n, p] = varint(v, 0)
  if (n >= 0 && p + n === v.length) {
    const s = v.subarray(p).toString('utf8')
    if (printable(s)) return { value: s, as: 'chữ' }
  }
  if (v.length === 1 && v[0] <= 1) return { value: v[0] ? 'true' : 'false', as: 'bool / số' }
  const [iv, ip] = varint(v, 0)
  if (iv >= 0 && ip === v.length) return { value: String(iv), as: 'số' }
  if (v.length === 8) {
    const d = v.readDoubleLE(0)
    if (Number.isFinite(d) && Math.abs(d) < 1e15) return { value: String(d), as: 'số thực' }
  }
  const s = v.toString('utf8')
  if (printable(s)) return { value: s, as: 'chữ' }
  return { value: v.subarray(0, 64).toString('hex') + (v.length > 64 ? '…' : ''), as: `hex (${v.length} byte)` }
}

/** Decode an MMKV file: 4-byte size, then (key, value) pairs, later pairs override earlier ones. */
export function parseMmkv(buf: Buffer): MmkvEntry[] {
  if (buf.length < 8) return []
  const size = buf.readUInt32LE(0)
  const data = buf.subarray(4, Math.min(buf.length, 4 + size))
  const map = new Map<string, MmkvEntry>()
  let [, i] = varint(data, 0) // item-size placeholder
  while (i < data.length) {
    const [kl, kp] = varint(data, i)
    if (kl <= 0 || kp + kl > data.length) break
    const key = data.subarray(kp, kp + kl).toString('utf8')
    const [vl, vp] = varint(data, kp + kl)
    if (vl < 0 || vp + vl > data.length) break
    if (!printable(key)) break // encrypted file or not MMKV
    if (vl === 0) map.delete(key)
    else map.set(key, { key, ...guess(data.subarray(vp, vp + vl)) })
    i = vp + vl
  }
  return [...map.values()]
}

export async function readMmkv(serial: string, pkg: string, path: string): Promise<MmkvEntry[]> {
  const buf = await adbBinary(['-s', serial, 'exec-out', 'run-as', pkg, 'cat', safePath(path)], 60_000)
  const list = parseMmkv(buf)
  if (!list.length && buf.length > 8) throw new Error('Không đọc được (file MMKV có thể được mã hóa)')
  return list
}
