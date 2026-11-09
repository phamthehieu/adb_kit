import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FNode, FPage, FPageRef, FScreen } from '../shared/figma'

/**
 * Figma REST access for the design-compare panel. The token is stored encrypted
 * (Windows DPAPI via safeStorage) in the app data folder; pages are cached reduced
 * (no vectors) so a page that is ~30 MB of JSON opens instantly the second time.
 */

const API = 'https://api.figma.com/v1'
const dataDir = (): string => join(app.getPath('userData'), 'figma')
const tokenFile = (): string => join(dataDir(), 'token.bin')
const cacheDir = (): string => join(dataDir(), 'cache')
const safe = (s: string): string => s.replace(/[^\w-]+/g, '_')

/* ------------------------------------------------------------------ token */

export function getToken(): string | null {
  try {
    if (existsSync(tokenFile())) {
      const buf = readFileSync(tokenFile())
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
    }
  } catch {
    /* unreadable (other user / machine): ask again */
  }
  // Developer convenience: a .figma-token file next to package.json (git-ignored).
  if (!app.isPackaged) {
    const dev = join(app.getAppPath(), '.figma-token')
    if (existsSync(dev)) return readFileSync(dev, 'utf8').trim() || null
  }
  return null
}

export function setToken(token: string): void {
  mkdirSync(dataDir(), { recursive: true })
  const t = token.trim()
  writeFileSync(tokenFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t, 'utf8'))
}

async function api<T>(path: string, timeoutMs = 240_000, retries = 2): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('Chưa nhập Figma token')

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(API + path, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok) {
      return (await res.json()) as T
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after')
      const waitSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : Math.min(30, Math.pow(2, attempt + 1) * 3)
      const validWait = isNaN(waitSec) || waitSec <= 0 ? 5 : waitSec

      if (attempt < retries && validWait <= 30) {
        // Tự động chờ và thử lại
        await new Promise((r) => setTimeout(r, validWait * 1000))
        continue
      }
      throw new Error(`Figma đang giới hạn số lần gọi (429). Vui lòng đợi khoảng ${validWait} giây rồi thử lại.`)
    }

    const body = await res.text().catch(() => '')
    if (res.status === 403) throw new Error('Figma từ chối (403): token sai/hết hạn, hoặc tài khoản không có quyền xem file này')
    if (res.status === 404) throw new Error('Không tìm thấy file / node trên Figma (404)')
    throw new Error(`Figma lỗi ${res.status}: ${body.slice(0, 200)}`)
  }

  throw new Error('Figma đang bận, vui lòng thử lại sau.')
}

/* ------------------------------------------------------------- reduce tree */

interface RawNode {
  id: string
  name: string
  type: string
  visible?: boolean
  children?: RawNode[]
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null
  characters?: string
  style?: { fontSize?: number; fontWeight?: number; lineHeightPx?: number }
  layoutMode?: string
  itemSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  layoutSizingHorizontal?: string
  layoutSizingVertical?: string
  fills?: { type: string; visible?: boolean; opacity?: number; color?: { r: number; g: number; b: number; a: number } }[]
  cornerRadius?: number
}

/** Shapes that are drawn, not laid out: kept as a leaf, children (paths) dropped. */
const LEAF_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'REGULAR_POLYGON', 'TEXT', 'RECTANGLE'])
const CONTAINERS = new Set(['FRAME', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET'])

const hex = (c: { r: number; g: number; b: number }): string =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')

function isScreen(n: RawNode): boolean {
  const b = n.absoluteBoundingBox
  // Accept any frame / component / container with valid dimensions without size restriction.
  return CONTAINERS.has(n.type) && !!b && b.width > 0 && b.height > 0
}

/** Is a node only decoration made of paths (illustration, logo)? Collapse it to one leaf. */
function onlyPaths(n: RawNode): boolean {
  if (!n.children?.length) return LEAF_TYPES.has(n.type) && n.type !== 'TEXT'
  return n.children.every(onlyPaths)
}

function reduceScreen(root: RawNode, section: string): FScreen {
  const o = root.absoluteBoundingBox!
  const nodes: FNode[] = []
  const add = (n: RawNode, parent: number): void => {
    if (n.visible === false) return
    const b = n.absoluteBoundingBox
    if (!b || b.width <= 0 || b.height <= 0) return
    // Clip to the screen: illustrations often bleed far outside.
    if (b.x + b.width <= o.x || b.y + b.height <= o.y || b.x >= o.x + o.width || b.y >= o.y + o.height) return
    const f: FNode = {
      id: n.id,
      name: n.name,
      type: n.type,
      x: round(b.x - o.x),
      y: round(b.y - o.y),
      w: round(b.width),
      h: round(b.height),
      parent
    }
    if (n.type === 'TEXT') {
      f.text = n.characters ?? ''
      f.fontSize = n.style?.fontSize
      f.fontWeight = n.style?.fontWeight
      f.lineHeight = n.style?.lineHeightPx ? round(n.style.lineHeightPx) : undefined
    }
    if (n.layoutMode && n.layoutMode !== 'NONE') {
      f.layout = {
        dir: n.layoutMode === 'HORIZONTAL' ? 'H' : 'V',
        gap: round(n.itemSpacing ?? 0),
        pad: [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0].map(round) as [number, number, number, number]
      }
    }
    if (n.layoutSizingHorizontal) f.sizeH = n.layoutSizingHorizontal
    if (n.layoutSizingVertical) f.sizeV = n.layoutSizingVertical
    const fill = n.fills?.find((p) => p.type === 'SOLID' && p.visible !== false && p.color)
    if (fill?.color) f.fill = hex(fill.color)
    if (n.cornerRadius) f.radius = round(n.cornerRadius)
    const idx = nodes.length
    nodes.push(f)
    if (n.type === 'TEXT' || !n.children?.length) return
    // Icons / illustrations: keep the wrapper, drop the hundreds of paths inside.
    if (n.children.every(onlyPaths)) return
    for (const c of n.children) add(c, idx)
  }
  add(root, -1)
  return { id: root.id, name: root.name, section, w: round(o.width), h: round(o.height), nodes }
}

const round = (v: number): number => Math.round(v * 10) / 10

function collectScreens(n: RawNode, path: string[], out: FScreen[]): void {
  if (n.visible === false) return
  if (isScreen(n)) {
    out.push(reduceScreen(n, path.join(' › ')))
    return
  }
  const next = n.type === 'SECTION' || n.type === 'GROUP' ? [...path, n.name] : path
  for (const c of n.children ?? []) collectScreens(c, next, out)
}

/** Every phone-sized frame under a node (page, section or a single frame), reduced. */
export function screensOf(doc: RawNode): FScreen[] {
  const out: FScreen[] = []
  collectScreens(doc, [], out)
  return out
}

/* ------------------------------------------------------------------ public */

const pagesCachePath = (fileKey: string): string => join(cacheDir(), `${safe(fileKey)}_pages.json`)

export async function listPages(fileKey: string, refresh = false): Promise<{ fileName: string; pages: FPageRef[] }> {
  const cp = pagesCachePath(fileKey)
  if (!refresh && existsSync(cp)) {
    try {
      const stat = statSync(cp)
      if (Date.now() - stat.mtimeMs < 2 * 3600_000) {
        return JSON.parse(readFileSync(cp, 'utf8')) as { fileName: string; pages: FPageRef[] }
      }
    } catch {
      /* fetch again */
    }
  }
  const r = await api<{ name: string; document: RawNode }>(`/files/${fileKey}?depth=1`, 60_000)
  const result = { fileName: r.name, pages: (r.document.children ?? []).map((p) => ({ id: p.id, name: p.name })) }
  try {
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(cp, JSON.stringify(result), 'utf8')
  } catch {
    /* non-fatal */
  }
  return result
}

const cachePath = (fileKey: string, nodeId: string): string => join(cacheDir(), `${safe(fileKey)}_${safe(nodeId)}.json`)

/** Screens of a page (or of any node: section, single frame). Cached unless `refresh`. */
export async function loadPage(fileKey: string, nodeId: string, refresh: boolean): Promise<FPage> {
  const cp = cachePath(fileKey, nodeId)
  if (!refresh && existsSync(cp)) {
    try {
      return JSON.parse(readFileSync(cp, 'utf8')) as FPage
    } catch {
      /* corrupted cache: fetch again */
    }
  }
  const r = await api<{ name: string; lastModified: string; nodes: Record<string, { document: RawNode } | null> }>(
    `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`
  )
  const doc = r.nodes[nodeId]?.document ?? r.nodes[nodeId.replace(':', '-')]?.document ?? Object.values(r.nodes)[0]?.document
  if (!doc) throw new Error(`Không thấy node ${nodeId} trong file`)
  let screens = screensOf(doc)
  // If no inner screens were found, but doc itself has a bounding box, treat it as a screen directly!
  if (!screens.length && doc.absoluteBoundingBox) {
    screens = [reduceScreen(doc, '')]
  }
  // If still no screens, add any child that has a bounding box!
  if (!screens.length && doc.children) {
    for (const c of doc.children) {
      if (c.absoluteBoundingBox) {
        screens.push(reduceScreen(c, ''))
      }
    }
  }
  const page: FPage = {
    fileKey,
    fileName: r.name,
    nodeId,
    pageName: doc.name,
    lastModified: r.lastModified,
    fetchedAt: Date.now(),
    screens
  }
  mkdirSync(cacheDir(), { recursive: true })
  writeFileSync(cp, JSON.stringify(page))
  return page
}

/** PNG of a frame (scale 2), cached on disk. */
export async function frameImage(fileKey: string, nodeId: string): Promise<Uint8Array> {
  const dir = join(cacheDir(), 'img', safe(fileKey))
  const file = join(dir, `${safe(nodeId)}.png`)
  if (existsSync(file)) return readFileSync(file)
  const r = await api<{ err: string | null; images: Record<string, string | null> }>(
    `/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&scale=2&format=png`,
    120_000
  )
  const url = r.images[nodeId]
  if (!url) throw new Error(r.err || 'Figma không render được frame này')
  const img = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!img.ok) throw new Error(`Không tải được ảnh frame (${img.status})`)
  const buf = Buffer.from(await img.arrayBuffer())
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, buf)
  return buf
}
