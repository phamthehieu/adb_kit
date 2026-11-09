import type { UiNode } from '@shared/automation'
import type { FNode, FScreen } from '@shared/figma'

/**
 * Pair an element on the device with its node in a Figma frame and measure both the
 * same way: size, insets inside the parent, gaps to the nearest neighbours, margins to
 * the screen edges. Everything is in dp (device) / Figma px, which are the same unit.
 *
 * Absolute positions are never compared: the design is drawn on an iPhone frame
 * (393 wide, 50 px status bar) while the device has its own width and bars.
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface AppEl extends Box {
  text: string
  desc: string
  cls: string
  id?: string
  clickable?: boolean
}

export interface Side {
  /** Neighbour / parent index in the same list. */
  idx: number
  gap: number
}

export interface Measure {
  w: number
  h: number
  parent: { idx: number; insets: [number, number, number, number] } | null // left, top, right, bottom
  top: Side | null
  bottom: Side | null
  left: Side | null
  right: Side | null
  screenLeft: number
  screenRight: number
}

export interface Match {
  idx: number
  how: 'chữ' | 'chữ bên trong' | 'vị trí' | 'chọn tay'
}

const r1 = (v: number): number => Math.round(v * 10) / 10
const area = (b: Box): number => b.w * b.h
const contains = (a: Box, b: Box, eps = 0.5): boolean =>
  b.x >= a.x - eps && b.y >= a.y - eps && b.x + b.w <= a.x + a.w + eps && b.y + b.h <= a.y + a.h + eps
const same = (a: Box, b: Box, eps = 0.5): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps
const overlap1d = (a1: number, a2: number, b1: number, b2: number): number => Math.min(a2, b2) - Math.max(a1, b1)

export const normText = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()

/* ------------------------------------------------------------------ device */

export function toAppEls(nodes: UiNode[], wPx: number, hPx: number, density: number): { els: AppEl[]; w: number; h: number } {
  const k = 160 / density
  const els = nodes.map((n) => ({
    x: r1(n.b[0] * wPx * k),
    y: r1(n.b[1] * hPx * k),
    w: r1((n.b[2] - n.b[0]) * wPx * k),
    h: r1((n.b[3] - n.b[1]) * hPx * k),
    text: n.text,
    desc: n.desc,
    cls: n.cls,
    id: n.id,
    clickable: n.clickable
  }))
  return { els, w: r1(wPx * k), h: r1(hPx * k) }
}

/** Smallest element under a point (dp). */
export function appAt(els: AppEl[], x: number, y: number): number {
  let best = -1
  for (let i = 0; i < els.length; i++) {
    const e = els[i]
    if (x < e.x || y < e.y || x > e.x + e.w || y > e.y + e.h) continue
    if (best < 0 || area(e) < area(els[best])) best = i
  }
  return best
}

/** Smallest Figma node under a point (frame coordinates), the frame itself excluded. */
export function figmaAt(s: FScreen, x: number, y: number): number {
  let best = -1
  for (let i = 1; i < s.nodes.length; i++) {
    const e = s.nodes[i]
    if (x < e.x || y < e.y || x > e.x + e.w || y > e.y + e.h) continue
    if (best < 0 || area(e) <= area(s.nodes[best])) best = i
  }
  return best
}

/* ------------------------------------------------------------- relations */

interface Side2 {
  boxes: Box[]
  /** Containing element used for insets (null = none). */
  parentOf: (i: number) => number
  /** i and j are the same element, an ancestor or a descendant of each other. */
  related: (i: number, j: number) => boolean
  screenW: number
  screenArea: number
  /** Never use as a neighbour (system bars drawn in the design). */
  ignore?: (j: number) => boolean
}

/** iOS / Android system chrome drawn into design frames: not part of the app's layout. */
const SYSTEM_BAR = /status ?bar|indicator|home ?bar|navigation ?bar|keyboard|bàn phím/i

function appSide(els: AppEl[], w: number, h: number): Side2 {
  const parentOf = (i: number): number => {
    let best = -1
    for (let j = 0; j < els.length; j++) {
      if (j === i || same(els[j], els[i]) || !contains(els[j], els[i])) continue
      if (best < 0 || area(els[j]) < area(els[best])) best = j
    }
    return best
  }
  return {
    boxes: els,
    parentOf,
    related: (i, j) => i === j || contains(els[i], els[j]) || contains(els[j], els[i]),
    screenW: w,
    screenArea: w * h
  }
}

function figmaSide(s: FScreen): Side2 {
  const n = s.nodes
  const ancestors = (i: number): Set<number> => {
    const set = new Set<number>()
    for (let p = n[i].parent; p >= 0; p = n[p].parent) set.add(p)
    return set
  }
  return {
    boxes: n,
    parentOf: (i) => {
      for (let p = n[i].parent; p >= 0; p = n[p].parent) if (!same(n[p], n[i])) return p
      return -1
    },
    related: (i, j) => i === j || ancestors(i).has(j) || ancestors(j).has(i),
    screenW: s.w,
    screenArea: s.w * s.h,
    ignore: (j) => {
      for (let p = j; p > 0; p = n[p].parent) if (SYSTEM_BAR.test(n[p].name)) return true
      return false
    }
  }
}

function measureOn(side: Side2, i: number): Measure {
  const b = side.boxes[i]
  const p = side.parentOf(i)
  const pb = p >= 0 ? side.boxes[p] : null
  const near = (dir: 'top' | 'bottom' | 'left' | 'right'): Side | null => {
    let best: Side | null = null
    for (let j = 0; j < side.boxes.length; j++) {
      if (side.related(i, j) || side.ignore?.(j)) continue
      const o = side.boxes[j]
      if (area(o) > side.screenArea * 0.4) continue // backgrounds, full-screen layers
      let gap: number
      if (dir === 'top' || dir === 'bottom') {
        if (overlap1d(b.x, b.x + b.w, o.x, o.x + o.w) <= 0) continue
        gap = dir === 'top' ? b.y - (o.y + o.h) : o.y - (b.y + b.h)
      } else {
        if (overlap1d(b.y, b.y + b.h, o.y, o.y + o.h) <= 0) continue
        gap = dir === 'left' ? b.x - (o.x + o.w) : o.x - (b.x + b.w)
      }
      if (gap < -0.5) continue
      if (!best || gap < best.gap - 0.5 || (Math.abs(gap - best.gap) <= 0.5 && area(o) < area(side.boxes[best.idx]))) best = { idx: j, gap: r1(Math.max(0, gap)) }
    }
    return best
  }
  return {
    w: b.w,
    h: b.h,
    parent: pb ? { idx: p, insets: [r1(b.x - pb.x), r1(b.y - pb.y), r1(pb.x + pb.w - b.x - b.w), r1(pb.y + pb.h - b.y - b.h)] } : null,
    top: near('top'),
    bottom: near('bottom'),
    left: near('left'),
    right: near('right'),
    screenLeft: r1(b.x),
    screenRight: r1(side.screenW - b.x - b.w)
  }
}

export const measureApp = (els: AppEl[], w: number, h: number, i: number): Measure => measureOn(appSide(els, w, h), i)
export const measureFigma = (s: FScreen, i: number): Measure => measureOn(figmaSide(s), i)

/** Distance from `b` to `o` in a direction, or null if `o` is not on that side. */
function gapTo(b: Box, o: Box, dir: 'top' | 'bottom' | 'left' | 'right'): number | null {
  const g =
    dir === 'top' ? b.y - (o.y + o.h) : dir === 'bottom' ? o.y - (b.y + b.h) : dir === 'left' ? b.x - (o.x + o.w) : o.x - (b.x + b.w)
  return g < -0.5 ? null : r1(Math.max(0, g))
}

/**
 * Measure an app element and its Figma node so that both sides use the *same* reference
 * elements: the app's parent / neighbours are paired with Figma too, and the Figma
 * distances are taken to those paired nodes. Falls back to Figma's own geometry when
 * a reference has no counterpart.
 */
export function measurePair(
  els: AppEl[],
  appW: number,
  appH: number,
  ai: number,
  s: FScreen,
  fi: number
): { app: Measure; fig: Measure } {
  const app = measureApp(els, appW, appH, ai)
  const fig = measureFigma(s, fi)
  const fs = figmaSide(s)
  const b = s.nodes[fi]
  if (app.parent) {
    const pm = matchFigma(els, appW, appH, app.parent.idx, s)
    if (pm && pm.idx !== fi && contains(s.nodes[pm.idx], b)) {
      const pb = s.nodes[pm.idx]
      fig.parent = { idx: pm.idx, insets: [r1(b.x - pb.x), r1(b.y - pb.y), r1(pb.x + pb.w - b.x - b.w), r1(pb.y + pb.h - b.y - b.h)] }
    }
  }
  for (const dir of ['top', 'bottom', 'left', 'right'] as const) {
    const an = app[dir]
    if (!an) continue
    const nm = matchFigma(els, appW, appH, an.idx, s)
    if (!nm || fs.related(fi, nm.idx)) continue
    const g = gapTo(b, s.nodes[nm.idx], dir)
    if (g !== null) fig[dir] = { idx: nm.idx, gap: g }
  }
  return { app, fig }
}

/* ---------------------------------------------------------------- matching */

const label = (e: AppEl): string => normText(e.text || e.desc)

/** Figma TEXT nodes carrying the same words, closest (relative height on screen) first. */
function textCandidates(s: FScreen, t: string, relY: number): number[] {
  if (!t) return []
  const exact: number[] = []
  const loose: number[] = []
  s.nodes.forEach((n, i) => {
    if (n.text === undefined) return
    const f = normText(n.text)
    if (f === t) exact.push(i)
    // Loose: one contains the other and they are of similar length (real data vs sample data,
    // trailing "*"…), never a short word inside a long sentence.
    else if (Math.min(t.length, f.length) >= 3 && Math.min(t.length, f.length) / Math.max(t.length, f.length) >= 0.6 && (f.includes(t) || t.includes(f)))
      loose.push(i)
  })
  const byY = (a: number, b: number): number =>
    Math.abs((s.nodes[a].y + s.nodes[a].h / 2) / s.h - relY) - Math.abs((s.nodes[b].y + s.nodes[b].h / 2) / s.h - relY)
  return [...exact.sort(byY), ...loose.sort(byY)]
}

const relY = (e: Box, h: number): number => (e.y + e.h / 2) / h

/** Closest-sized node among `cands` (height weighs more: widths stretch with the screen). */
function closestSize(s: FScreen, cands: number[], e: Box): number {
  let best = -1
  let bestCost = Infinity
  for (const i of cands) {
    const n = s.nodes[i]
    const cost = Math.abs(n.h - e.h) * 2 + Math.abs(n.w - e.w) * 0.5
    if (cost < bestCost) {
      bestCost = cost
      best = i
    }
  }
  return best
}

export function matchFigma(els: AppEl[], appW: number, appH: number, ai: number, s: FScreen): Match | null {
  const e = els[ai]
  if (e.w * e.h > appW * appH * 0.5 && !label(e)) return null // the window / root layout
  const t = label(e)

  // 1. The element has text itself.
  const own = textCandidates(s, t, relY(e, appH))
  if (own.length) return { idx: own[0], how: 'chữ' }

  // 2. A container: find the Figma node that holds the same texts and has the closest size.
  const inner = els
    .map((o, j) => ({ o, j }))
    .filter(({ o, j }) => j !== ai && label(o) && contains(e, o))
    .map(({ o }) => textCandidates(s, label(o), relY(o, appH))[0])
    .filter((i): i is number => i !== undefined)
  if (inner.length) {
    const boxes = inner.map((i) => s.nodes[i])
    const cands: number[] = []
    for (let p: number = inner[0]; p >= 0; p = s.nodes[p].parent) if (p > 0 && boxes.every((b) => contains(s.nodes[p], b))) cands.push(p)
    if (cands.length) return { idx: closestSize(s, cands, e), how: 'chữ bên trong' }
  }

  // 3. No text: shift the element by the offset of the nearest matched text, take the best overlap.
  let dx = 0
  let dy = 0
  let anchorDist = Infinity
  els.forEach((o, j) => {
    if (j === ai || !label(o)) return
    const d = Math.hypot(o.x + o.w / 2 - (e.x + e.w / 2), o.y + o.h / 2 - (e.y + e.h / 2))
    if (d >= anchorDist) return
    const m = textCandidates(s, label(o), relY(o, appH))[0]
    if (m === undefined) return
    const n = s.nodes[m]
    anchorDist = d
    // Horizontal: keep the same margin from the nearer screen edge.
    const fromRight = o.x + o.w / 2 > appW / 2
    dx = fromRight ? s.w - appW : 0
    dy = n.y - o.y
  })
  if (anchorDist === Infinity) dy = 0
  const p: Box = { x: e.x + dx, y: e.y + dy, w: e.w, h: e.h }
  let best = -1
  let bestScore = 0
  for (let i = 1; i < s.nodes.length; i++) {
    const n = s.nodes[i]
    if (area(n) > s.w * s.h * 0.5) continue // backgrounds / whole-screen layers say nothing
    const ix = overlap1d(p.x, p.x + p.w, n.x, n.x + n.w)
    const iy = overlap1d(p.y, p.y + p.h, n.y, n.y + n.h)
    if (ix <= 0 || iy <= 0) continue
    const inter = ix * iy
    const iou = inter / (area(p) + area(n) - inter)
    if (iou > bestScore) {
      bestScore = iou
      best = i
    }
  }
  return best >= 0 && bestScore > 0.2 ? { idx: best, how: 'vị trí' } : null
}

/* ------------------------------------------------------------- screen guess */

const isStatic = (t: string): boolean => t.length >= 2 && !/^[\d\s:.,/+%-]+$/.test(t)

/** Frames ranked by how many of the texts on the device screen they contain (Dice score). */
export function suggestScreens(els: AppEl[], screens: FScreen[], limit = 5): { idx: number; score: number }[] {
  const app = new Set(els.map(label).filter(isStatic))
  if (!app.size) return []
  return screens
    .map((s, idx) => {
      const fig = new Set(s.nodes.filter((n) => n.text !== undefined).map((n) => normText(n.text!)).filter(isStatic))
      let hit = 0
      for (const t of app) if (fig.has(t)) hit++
      return { idx, score: fig.size ? (2 * hit) / (app.size + fig.size) : 0 }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Short name for a node in tables. */
export function figmaLabel(n: FNode): string {
  return n.text !== undefined ? `"${n.text.replace(/\s+/g, ' ').slice(0, 28)}"` : n.name
}
export function appLabel(e: AppEl): string {
  const t = (e.text || e.desc).replace(/\s+/g, ' ')
  return t ? `"${t.slice(0, 28)}"` : e.cls || 'View'
}
