import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

export interface VisualOptions {
  /** Allowed share of differing pixels, in percent. */
  tolerance: number
  /** Ignore status bar (clock, battery…) and navigation bar. */
  ignoreBars: boolean
  /** Extra normalized regions to ignore. */
  masks?: [number, number, number, number][]
  /** Replace the reference with the current screen. */
  update: boolean
}

export interface VisualResult {
  /** Percent of pixels that differ (after masks). */
  diffPercent: number
  /** File names inside the report folder. */
  baselineFile: string
  currentFile: string
  diffFile?: string
  /** Reference did not exist (or update requested): the current screen became the reference. */
  created: boolean
  sizeMismatch?: string
}

/** Status bar / navigation bar share of the screen height (portrait phones). */
const TOP_BAR = 0.04
const BOTTOM_BAR = 0.025

/** Copy the reference pixels into `cur` inside a normalized region, so it never counts as different. */
function maskRegion(base: PNG, cur: PNG, [x1, y1, x2, y2]: [number, number, number, number]): void {
  const w = base.width
  const h = base.height
  const xa = Math.max(0, Math.floor(x1 * w))
  const xb = Math.min(w, Math.ceil(x2 * w))
  const ya = Math.max(0, Math.floor(y1 * h))
  const yb = Math.min(h, Math.ceil(y2 * h))
  for (let y = ya; y < yb; y++) {
    const start = (y * w + xa) * 4
    base.data.copy(cur.data, start, start, (y * w + xb) * 4)
  }
}

/**
 * Compare a screenshot with the reference image. When no reference exists yet (first run)
 * or `update` is set, the screenshot becomes the reference. Writes the reference, the
 * current screen and a diff image (differences in red) into `outDir` for the report.
 */
export function compareScreen(png: Buffer, baselinePath: string, outDir: string, label: string, o: VisualOptions): VisualResult {
  const safe = label.replace(/[^\w-]+/g, '_')
  const currentFile = `visual_${safe}_hien-tai.png`
  const baselineFile = `visual_${safe}_chuan.png`
  writeFileSync(join(outDir, currentFile), png)

  if (o.update || !existsSync(baselinePath)) {
    mkdirSync(dirname(baselinePath), { recursive: true })
    writeFileSync(baselinePath, png)
    copyFileSync(baselinePath, join(outDir, baselineFile))
    return { diffPercent: 0, baselineFile, currentFile, created: true }
  }

  copyFileSync(baselinePath, join(outDir, baselineFile))
  const base = PNG.sync.read(readFileSync(baselinePath))
  const cur = PNG.sync.read(png)
  if (base.width !== cur.width || base.height !== cur.height) {
    return {
      diffPercent: 100,
      baselineFile,
      currentFile,
      created: false,
      sizeMismatch: `ảnh chuẩn ${base.width}×${base.height}, màn hình hiện tại ${cur.width}×${cur.height} (đã xoay hoặc đổi độ phân giải?)`
    }
  }

  const regions: [number, number, number, number][] = [...(o.masks ?? [])]
  if (o.ignoreBars) regions.push([0, 0, 1, TOP_BAR], [0, 1 - BOTTOM_BAR, 1, 1])
  for (const r of regions) maskRegion(base, cur, r)

  const diff = new PNG({ width: base.width, height: base.height })
  // threshold 0.1 ignores anti-aliasing / compression noise; includeAA=false skips AA pixels.
  const n = pixelmatch(base.data, cur.data, diff.data, base.width, base.height, { threshold: 0.1, includeAA: false, alpha: 0.35 })
  const diffFile = `visual_${safe}_khac-biet.png`
  writeFileSync(join(outDir, diffFile), PNG.sync.write(diff))
  return { diffPercent: Math.round((n / (base.width * base.height)) * 10_000) / 100, baselineFile, currentFile, diffFile, created: false }
}
