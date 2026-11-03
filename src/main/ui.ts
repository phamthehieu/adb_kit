import { adbBinary, shell } from './adb'
import type { UiNode } from '../shared/automation'

/** `<node …>`, `<node …/>` or `</node>`. */
const TAG_RE = /<node\b([^>]*?)(\/?)>|<\/node>/g
const ATTR_RE = /([\w-]+)="([^"]*)"/g
const BOUNDS_RE = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/

const unescape = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

/**
 * Dump the current UI hierarchy (uiautomator, ~2 s) and return a flat node list with
 * bounds normalized to the screen size. Fails on secure screens or while another
 * uiautomator session is running.
 */
export async function dumpUi(serial: string): Promise<{ nodes: UiNode[]; width: number; height: number }> {
  // Bounds must be normalized by the real (rotation-aware) display size: the largest node
  // is not the screen (e.g. the navigation bar is often missing from the hierarchy).
  const [buf, disp] = await Promise.all([
    adbBinary(['-s', serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], 20_000),
    shell(serial, 'dumpsys window displays')
  ])
  const cur = /cur=(\d+)x(\d+)/.exec(disp.stdout)
  return parseUiXml(buf.toString('utf8'), cur ? [+cur[1], +cur[2]] : null)
}

/** Parse uiautomator XML; `screen` = real display size in px (else the largest node). */
export function parseUiXml(out: string, screen: [number, number] | null): { nodes: UiNode[]; width: number; height: number } {
  const xmlEnd = out.lastIndexOf('</hierarchy>')
  if (xmlEnd < 0) throw new Error(out.trim().split('\n').pop() || 'uiautomator dump failed')
  const raw: { a: Record<string, string>; b: number[]; parent: number }[] = []
  let width = 0
  let height = 0
  // Walk open / close tags to know each node's parent. `stack` holds, per open element, the
  // index of the nearest kept (visible) node at or above it.
  const stack: number[] = []
  for (const m of out.slice(0, xmlEnd).matchAll(TAG_RE)) {
    if (m[0].startsWith('</')) {
      stack.pop()
      continue
    }
    const selfClosing = m[2] === '/'
    const up = stack.length ? stack[stack.length - 1] : -1
    const a: Record<string, string> = {}
    for (const at of m[1].matchAll(ATTR_RE)) a[at[1]] = unescape(at[2])
    const bm = BOUNDS_RE.exec(a.bounds ?? '')
    const b = bm ? bm.slice(1).map(Number) : null
    // Off-screen nodes (e.g. WebView content not scrolled into view) report empty bounds;
    // they are not "visible", so leave them out entirely.
    let here = up
    if (b && b[2] > b[0] && b[3] > b[1]) {
      width = Math.max(width, b[2])
      height = Math.max(height, b[3])
      here = raw.length
      raw.push({ a, b, parent: up })
    }
    if (!selfClosing) stack.push(here)
  }
  if (!width || !height) throw new Error('empty UI hierarchy')
  if (screen) [width, height] = screen
  const nodes = raw.map(({ a, b, parent }) => ({
    id: a['resource-id'] ?? '',
    text: a.text ?? '',
    desc: a['content-desc'] ?? '',
    cls: (a.class ?? '').split('.').pop() ?? '',
    pkg: a.package ?? '',
    clickable: a.clickable === 'true',
    b: [b[0] / width, b[1] / height, b[2] / width, b[3] / height] as [number, number, number, number],
    parent,
    enabled: a.enabled !== 'false'
  }))
  return { nodes, width, height }
}
