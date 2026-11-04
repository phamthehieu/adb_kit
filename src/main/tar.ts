/**
 * Minimal tar reader/writer (POSIX ustar + the GNU long-name / pax extensions Android's toybox
 * `tar` emits). Used to check an app-data archive that came off a phone is intact and to count
 * what is inside, without any native dependency.
 */

export interface TarEntry {
  name: string
  data?: Buffer
  dir?: boolean
  mode?: number
}

export interface TarListing {
  name: string
  size: number
  dir: boolean
}

const BLOCK = 512

const octal = (n: number, len: number): string => n.toString(8).padStart(len - 1, '0') + '\0'

function field(buf: Buffer, from: number, len: number): string {
  const end = buf.indexOf(0, from)
  return buf.toString('utf8', from, end >= 0 && end < from + len ? end : from + len)
}

function readSize(h: Buffer): number {
  // GNU base-256 for very large files, plain octal otherwise.
  if (h[124] & 0x80) {
    let n = 0
    for (let i = 125; i < 136; i++) n = n * 256 + h[i]
    return n
  }
  const s = h.toString('ascii', 124, 136).replace(/\0.*$/, '').trim()
  return s ? parseInt(s, 8) : 0
}

function checksumOk(h: Buffer): boolean {
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]
  const want = parseInt(h.toString('ascii', 148, 156).replace(/\0.*$/, '').trim(), 8)
  return sum === want
}

/** Build a tar archive (tests, and "export" of a saved state). */
export function packTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    const data = e.dir ? Buffer.alloc(0) : (e.data ?? Buffer.alloc(0))
    const h = Buffer.alloc(BLOCK)
    const name = Buffer.from(e.name)
    if (name.length > 100) throw new Error('name too long for this simple writer')
    name.copy(h, 0)
    h.write(octal(e.mode ?? (e.dir ? 0o755 : 0o644), 8), 100, 'ascii')
    h.write(octal(0, 8), 108, 'ascii')
    h.write(octal(0, 8), 116, 'ascii')
    h.write(octal(data.length, 12), 124, 'ascii')
    h.write(octal(0, 12), 136, 'ascii')
    h.write('        ', 148, 'ascii')
    h.write(e.dir ? '5' : '0', 156, 'ascii')
    h.write('ustar\0', 257, 'ascii')
    h.write('00', 263, 'ascii')
    let sum = 0
    for (let i = 0; i < BLOCK; i++) sum += h[i]
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
    parts.push(h, data)
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK
    if (pad) parts.push(Buffer.alloc(pad))
  }
  parts.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(parts)
}

/** List an archive; throws when it is truncated or a header is corrupt. */
export function listTar(buf: Buffer): TarListing[] {
  const out: TarListing[] = []
  let off = 0
  let longName: string | null = null
  let sawEnd = false
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK)
    if (h.every((b) => b === 0)) {
      sawEnd = true
      break
    }
    if (!checksumOk(h)) throw new Error(`tar hỏng ở byte ${off} (sai checksum)`)
    const size = readSize(h)
    const type = String.fromCharCode(h[156] || 48)
    const bodyStart = off + BLOCK
    const bodyEnd = bodyStart + size
    if (bodyEnd > buf.length) throw new Error('tar bị cắt cụt (thiếu dữ liệu)')
    if (type === 'L') {
      longName = buf.toString('utf8', bodyStart, bodyEnd).replace(/\0.*$/, '')
    } else if (type === 'x' || type === 'g') {
      /* pax header: nothing we need */
    } else {
      const prefix = field(h, 345, 155)
      const base = field(h, 0, 100)
      const name = longName ?? (prefix ? `${prefix}/${base}` : base)
      longName = null
      out.push({ name, size, dir: type === '5' || name.endsWith('/') })
    }
    off = bodyStart + Math.ceil(size / BLOCK) * BLOCK
  }
  if (!sawEnd && off < buf.length) throw new Error('tar bị cắt cụt (thiếu phần kết thúc)')
  if (!sawEnd && out.length === 0) throw new Error('tar rỗng')
  return out
}
