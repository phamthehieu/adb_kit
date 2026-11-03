import type { UiNode } from './automation'
import type { UiIssue } from './devconf'

/**
 * Checks the current screen (uiautomator tree + a screenshot) for common UI problems:
 * small touch targets, unlabeled buttons, overlapping text, text cut off or spilling out of
 * its container, text touching the screen edge, and low text contrast. Heuristics — each
 * finding says why it was flagged so a tester can judge.
 */

type B = UiNode['b']
const area = (b: B): number => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
const inter = (a: B, b: B): B => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]
const SYSTEM = /^(com\.android\.systemui|android)$/
const SCROLLER = /Scroll|Recycler|List|Pager|Grid|Web/i

export interface LintInput {
  nodes: UiNode[]
  /** Screen size in px and density (dpi), to convert to dp. */
  width: number
  height: number
  density: number
  /** Screenshot pixels at the same size as the dump, for the contrast check. */
  image?: ImageData | null
}

const label = (n: UiNode): string => (n.text || n.desc || (n.id ? n.id.split('/').pop() : '') || n.cls || '').slice(0, 60)

export function lintUi({ nodes, width, height, density, image }: LintInput): UiIssue[] {
  const dp = (fx: number, px: number): number => (fx * px * 160) / density
  const wdp = (b: B): number => dp(b[2] - b[0], width)
  const hdp = (b: B): number => dp(b[3] - b[1], height)
  const app = nodes.filter((n) => !SYSTEM.test(n.pkg))
  const idx = new Map(nodes.map((n, i) => [n, i]))
  const ancestors = (i: number): number[] => {
    const out: number[] = []
    for (let p = nodes[i].parent ?? -1, guard = 0; p >= 0 && guard < 200; p = nodes[p].parent ?? -1, guard++) out.push(p)
    return out
  }
  const anc = nodes.map((_, i) => new Set(ancestors(i)))
  const related = (i: number, j: number): boolean => anc[i].has(j) || anc[j].has(i)
  // Text found in a node or any of its descendants (labels a button for screen readers).
  const labelled = new Set<number>()
  nodes.forEach((n, i) => {
    if (!(n.text.trim() || n.desc.trim())) return
    labelled.add(i)
    anc[i].forEach((a) => labelled.add(a))
  })
  const out: UiIssue[] = []
  const screen = 1

  for (const n of app) {
    const i = idx.get(n)!
    const w = wdp(n.b)
    const h = hdp(n.b)
    const big = area(n.b) > 0.5 * screen

    // 1. Touch target size (Android: ≥ 48 × 48 dp).
    if (n.clickable && n.enabled !== false && !big && (w < 48 || h < 48)) {
      const coveredByParent = [...anc[i]].some((a) => nodes[a].clickable && wdp(nodes[a].b) >= 48 && hdp(nodes[a].b) >= 48)
      if (!coveredByParent) {
        out.push({
          kind: 'target',
          level: w < 32 || h < 32 ? 'bad' : 'warn',
          b: n.b,
          title: `Vùng bấm nhỏ ${Math.round(w)}×${Math.round(h)} dp`,
          detail: `“${label(n)}” — nên tối thiểu 48×48 dp để dễ bấm.`
        })
      }
    }

    // 2. Clickable without any text / description: TalkBack reads it as an unnamed button.
    if (n.clickable && n.enabled !== false && !big && !labelled.has(i)) {
      out.push({
        kind: 'label',
        level: 'warn',
        b: n.b,
        title: 'Nút không có nhãn',
        detail: `${n.cls || 'Phần tử'}${n.id ? ` (${n.id.split('/').pop()})` : ''} bấm được nhưng không có chữ hay contentDescription — người dùng TalkBack không biết nút này làm gì.`
      })
    }

    if (!n.text.trim()) continue

    // 3. Text visibly truncated.
    if (/…$|\.\.\.$/.test(n.text.trim())) {
      out.push({ kind: 'cut', level: 'warn', b: n.b, title: 'Chữ bị cắt “…”', detail: `“${n.text.slice(0, 80)}” — chữ không đủ chỗ hiển thị.` })
    }

    // 4. Text spilling outside its (non-scrolling) container.
    const p = n.parent ?? -1
    if (p >= 0 && !SCROLLER.test(nodes[p].cls)) {
      const pb = nodes[p].b
      const over = Math.max(pb[0] - n.b[0], n.b[2] - pb[2], 0) * width * 160 / density + Math.max(pb[1] - n.b[1], n.b[3] - pb[3], 0) * height * 160 / density
      if (over > 2) {
        out.push({ kind: 'cut', level: 'warn', b: n.b, title: `Chữ tràn ra ngoài khung ${Math.round(over)} dp`, detail: `“${label(n)}” vượt ra ngoài phần tử chứa nó (${nodes[p].cls}).` })
      }
    }

    // 5. Text glued to the screen edge (likely cut off on narrower screens / bigger fonts).
    const wide = n.b[2] - n.b[0] > 0.9
    if (!wide && (n.b[0] <= 0.002 || n.b[2] >= 0.998)) {
      out.push({ kind: 'edge', level: 'warn', b: n.b, title: 'Chữ sát mép màn hình', detail: `“${label(n)}” chạm mép ${n.b[0] <= 0.002 ? 'trái' : 'phải'} — có thể đang bị cắt.` })
    }
  }

  // 6. Overlapping text / overlapping touch targets (not nested in each other).
  const texts = app.filter((n) => n.text.trim())
  for (let a = 0; a < texts.length; a++) {
    for (let c = a + 1; c < texts.length; c++) {
      const A = texts[a]
      const C = texts[c]
      const ia = idx.get(A)!
      const ic = idx.get(C)!
      if (related(ia, ic)) continue
      const ov = area(inter(A.b, C.b))
      const small = Math.min(area(A.b), area(C.b))
      if (small > 0 && ov / small > 0.2) {
        out.push({
          kind: 'overlap',
          level: 'bad',
          b: [Math.min(A.b[0], C.b[0]), Math.min(A.b[1], C.b[1]), Math.max(A.b[2], C.b[2]), Math.max(A.b[3], C.b[3])],
          title: 'Chữ đè lên nhau',
          detail: `“${label(A)}” và “${label(C)}” chồng lên nhau ${Math.round((ov / small) * 100)}%.`
        })
      }
    }
  }
  const taps = app.filter((n) => n.clickable && area(n.b) < 0.5)
  for (let a = 0; a < taps.length; a++) {
    for (let c = a + 1; c < taps.length; c++) {
      const ia = idx.get(taps[a])!
      const ic = idx.get(taps[c])!
      if (related(ia, ic)) continue
      const ov = area(inter(taps[a].b, taps[c].b))
      const small = Math.min(area(taps[a].b), area(taps[c].b))
      if (small > 0 && ov / small > 0.3) {
        out.push({ kind: 'overlap', level: 'warn', b: inter(taps[a].b, taps[c].b), title: 'Hai vùng bấm chồng nhau', detail: `“${label(taps[a])}” và “${label(taps[c])}” — bấm vào chỗ chồng không rõ trúng nút nào.` })
      }
    }
  }

  // 7. Text contrast (WCAG): background = dominant colour in the box, text = the most
  // contrasting colour that covers enough pixels. Skipped over photos / gradients.
  if (image) {
    for (const n of texts) {
      const r = contrastOf(image, n.b)
      if (!r) continue
      const large = hdp(n.b) >= 30
      const need = large ? 3 : 4.5
      if (r.ratio < need) {
        out.push({
          kind: 'contrast',
          level: r.ratio < 3 ? 'bad' : 'warn',
          b: n.b,
          title: `Tương phản chữ thấp ${r.ratio.toFixed(2)}:1`,
          detail: `“${label(n)}” — chữ ${r.fg} trên nền ${r.bg}; cần ≥ ${need}:1${large ? ' (chữ lớn)' : ''}.`
        })
      }
    }
  }

  // One finding per element and kind; most serious first, then top to bottom.
  const seen = new Set<string>()
  return out
    .filter((x) => {
      const k = `${x.kind}|${x.title.split(' ')[0]}|${x.b.map((v) => v.toFixed(3)).join(',')}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => Number(a.level !== 'bad') - Number(b.level !== 'bad') || a.b[1] - b.b[1])
}

const lum = (r: number, g: number, b: number): number => {
  const f = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

function contrastOf(img: ImageData, b: B): { ratio: number; fg: string; bg: string } | null {
  const x1 = Math.max(0, Math.floor(b[0] * img.width))
  const y1 = Math.max(0, Math.floor(b[1] * img.height))
  const x2 = Math.min(img.width, Math.ceil(b[2] * img.width))
  const y2 = Math.min(img.height, Math.ceil(b[3] * img.height))
  if (x2 - x1 < 6 || y2 - y1 < 6) return null
  const step = Math.max(1, Math.floor(Math.sqrt(((x2 - x1) * (y2 - y1)) / 4000)))
  // Colours quantized to 4 bits per channel → counts.
  const counts = new Map<number, number>()
  let total = 0
  for (let y = y1; y < y2; y += step) {
    for (let x = x1; x < x2; x += step) {
      const o = (y * img.width + x) * 4
      const q = ((img.data[o] >> 4) << 8) | ((img.data[o + 1] >> 4) << 4) | (img.data[o + 2] >> 4)
      counts.set(q, (counts.get(q) ?? 0) + 1)
      total++
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [bgQ, bgN] = sorted[0]
  if (bgN / total < 0.35) return null // busy background (photo, gradient): can't judge
  const rgb = (q: number): [number, number, number] => [((q >> 8) & 15) * 17, ((q >> 4) & 15) * 17, (q & 15) * 17]
  const bgL = lum(...rgb(bgQ))
  let best: { q: number; ratio: number } | null = null
  for (const [q, nPix] of sorted.slice(1)) {
    if (nPix / total < 0.02) break // anti-aliasing noise
    const L = lum(...rgb(q))
    const ratio = (Math.max(L, bgL) + 0.05) / (Math.min(L, bgL) + 0.05)
    if (!best || ratio > best.ratio) best = { q, ratio }
  }
  if (!best) return null
  const toHex = (q: number): string => {
    const [r, g, bl] = rgb(q)
    return hex((r << 16) | (g << 8) | bl)
  }
  return { ratio: best.ratio, fg: toHex(best.q), bg: toHex(bgQ) }
}
