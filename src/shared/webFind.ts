// "Đọc nhanh WebView": look an element up in the page's DOM (DevTools) instead of dumping the
// whole Android UI tree (~2 s). Everything here is pure so it can be unit-tested; the runner
// decides when the result may be trusted (see Runner.find).
import type { Selector, UiNode } from './automation'

/** One visible DOM element matching the selector; `b` is in CSS px relative to the viewport. */
export interface WebHit {
  b: [number, number, number, number]
  id: string
  text: string
  desc: string
  clickable: boolean
}

export interface WebHits {
  /** Viewport size in CSS px (window.innerWidth / innerHeight). */
  vw: number
  vh: number
  /** The page has focus: no dialog, permission prompt or other window is on top of it. */
  focused: boolean
  hits: WebHit[]
}

/** Where the WebView sits on the screen, as DevTools reports it (unit decided by calibration). */
export interface WebViewPlacement {
  x: number
  y: number
  w: number
  h: number
}

/** Unit of {@link WebViewPlacement}: physical pixels or density-independent pixels. */
export type WebUnit = 'px' | 'dip'

export interface DisplayInfo {
  w: number
  h: number
  density: number
}

/**
 * Android resource ids look like "com.app:id/login"; an HTML id never does. A selector with an
 * Android id points at a native view, so the DOM is not the place to look.
 */
export const isWebSelector = (s: Selector): boolean => !!(s.id || s.text || s.desc) && !(s.id && /[:/]/.test(s.id))

/**
 * JavaScript evaluated in the page. It only reads the DOM. Text comparison follows
 * `matches()` in automation.ts (exact = identical; contains / prefix = trimmed, case-insensitive).
 * An element counts only when it is really visible: non-empty box, centre inside the viewport,
 * not hidden, and not covered by another element at its centre.
 */
export function webFindExpression(sel: Selector): string {
  return `(${PAGE_FN})(${JSON.stringify({ id: sel.id ?? '', text: sel.text ?? '', desc: sel.desc ?? '', match: sel.match ?? 'exact' })})`
}

const PAGE_FN = String.raw`function (sel) {
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  var ok = function (actual, wanted) {
    if (!wanted) return true
    var a = actual.trim().toLowerCase(), w = wanted.trim().toLowerCase()
    if (sel.match === 'contains') return a.indexOf(w) >= 0
    if (sel.match === 'prefix') return a.indexOf(w) === 0
    return actual === wanted
  }
  var textOf = function (el) {
    var tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return norm(el.value)
    return norm(el.innerText)
  }
  var descOf = function (el) { return norm(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title')) }
  var vw = window.innerWidth, vh = window.innerHeight
  var out = { vw: vw, vh: vh, focused: document.hasFocus() && document.visibilityState === 'visible', hits: [] }
  var vv = window.visualViewport
  if (!vw || !vh || (vv && Math.abs(vv.scale - 1) > 0.01)) { out.focused = false; return JSON.stringify(out) }

  var cands = []
  var add = function (el) { if (el && cands.indexOf(el) < 0) cands.push(el) }
  if (sel.id) {
    add(document.getElementById(sel.id))
  } else if (sel.text) {
    var want = norm(sel.text).toLowerCase()
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
    var node
    while ((node = walker.nextNode()) && cands.length < 200) {
      var piece = norm(node.data).toLowerCase()
      if (!piece || (piece.indexOf(want) < 0 && want.indexOf(piece) < 0)) continue
      // Deepest element whose whole text matches (a label split over <span>s matches higher up).
      var el = node.parentElement
      for (var up = 0; el && up < 5; up++, el = el.parentElement) {
        if (ok(textOf(el), sel.text)) { add(el); break }
      }
    }
    var fields = document.querySelectorAll('input, textarea')
    for (var f = 0; f < fields.length && f < 500; f++) if (fields[f].value && ok(textOf(fields[f]), sel.text)) add(fields[f])
  } else if (sel.desc) {
    var labelled = document.querySelectorAll('[aria-label], [alt], [title]')
    for (var i = 0; i < labelled.length && i < 2000; i++) add(labelled[i])
  }

  for (var c = 0; c < cands.length && out.hits.length < 30; c++) {
    var e = cands[c]
    if (!ok(textOf(e), sel.text) || !ok(descOf(e), sel.desc)) continue
    var r = e.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue
    var st = getComputedStyle(e)
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue
    var top = document.elementFromPoint(cx, cy)
    if (!top || !(top === e || e.contains(top) || top.contains(e))) continue
    var click = !!e.closest('a, button, [role="button"], [role="link"], [role="tab"], [onclick], input, select, textarea, label, summary') || st.cursor === 'pointer'
    out.hits.push({ b: [r.left, r.top, r.right, r.bottom], id: e.id || '', text: textOf(e), desc: descOf(e), clickable: click })
  }
  return JSON.stringify(out)
}`

/** Parse what {@link webFindExpression} returned; null when it is not the expected shape. */
export function parseWebHits(json: unknown): WebHits | null {
  if (typeof json !== 'string') return null
  try {
    const o = JSON.parse(json) as WebHits
    if (!(o.vw > 0) || !(o.vh > 0) || !Array.isArray(o.hits)) return null
    const hits = o.hits.filter((h) => Array.isArray(h.b) && h.b.length === 4 && h.b.every((v) => Number.isFinite(v)))
    return { vw: o.vw, vh: o.vh, focused: o.focused === true, hits }
  } catch {
    return null
  }
}

/**
 * The `description` of a page in the WebView's DevTools list is JSON such as
 * {"attached":true,"empty":false,"height":640,"screenX":0,"screenY":24,"visible":true,"width":360}.
 * Returns null for pages that are not on screen.
 */
export function parsePlacement(description: string | undefined): WebViewPlacement | null {
  if (!description) return null
  try {
    const d = JSON.parse(description) as Record<string, unknown>
    if (d.attached !== true || d.visible !== true || d.empty === true) return null
    const [x, y, w, h] = [d.screenX, d.screenY, d.width, d.height].map(Number)
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
    return { x, y, w, h }
  } catch {
    return null
  }
}

/** Current (rotation-aware) screen size and density from `dumpsys window displays`. */
export function parseDisplay(dumpsys: string): DisplayInfo | null {
  const cur = /\bcur=(\d+)x(\d+)/.exec(dumpsys)
  // "base=" is printed only when the size / density was overridden (wm size, wm density).
  const dpi = /\bbase=\d+x\d+ (\d+)dpi/.exec(dumpsys) ?? /\binit=\d+x\d+ (\d+)dpi/.exec(dumpsys)
  if (!cur || !dpi) return null
  const d = { w: +cur[1], h: +cur[2], density: +dpi[1] }
  return d.w > 0 && d.h > 0 && d.density > 0 ? d : null
}

/**
 * DOM hits → nodes with bounds normalized to the screen, like the ones of a UI dump.
 * CSS px are scaled by placement.w / viewport width, so page zoom and "wide viewport" pages
 * need no special case; `unit` says how the placement itself is expressed.
 */
export function webHitsToNodes(hits: WebHits, place: WebViewPlacement, screen: DisplayInfo, unit: WebUnit): UiNode[] {
  const k = unit === 'dip' ? screen.density / 160 : 1
  const sx = (place.w / hits.vw) * k
  const sy = (place.h / hits.vh) * k
  const ox = place.x * k
  const oy = place.y * k
  const clamp = (v: number): number => Math.min(1, Math.max(0, v))
  return hits.hits.map((h) => ({
    id: h.id,
    text: h.text,
    desc: h.desc,
    cls: 'web',
    pkg: '',
    clickable: h.clickable,
    b: [clamp((ox + h.b[0] * sx) / screen.w), clamp((oy + h.b[1] * sy) / screen.h), clamp((ox + h.b[2] * sx) / screen.w), clamp((oy + h.b[3] * sy) / screen.h)],
    enabled: true
  }))
}

/** Distance between the centres of two nodes, in screen fractions. */
export function centerDistance(a: UiNode, b: UiNode): number {
  const dx = (a.b[0] + a.b[2]) / 2 - (b.b[0] + b.b[2]) / 2
  const dy = (a.b[1] + a.b[3]) / 2 - (b.b[1] + b.b[3]) / 2
  return Math.hypot(dx, dy)
}
