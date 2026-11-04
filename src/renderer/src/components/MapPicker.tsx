import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'

/**
 * Small dependency-free slippy map (Web Mercator, 256 px raster tiles): drag to pan, wheel or
 * +/- to zoom around the cursor, click to pick a point. Shows markers A / B, the line between
 * them and an optional "phone is here" dot.
 */

export type LatLng = [number, number]

const TILE = 256
const MIN_Z = 3
const MAX_Z = 19
/**
 * Tile sources, tried in order: some networks block one host (e.g. openstreetmap.org), so the
 * map switches to the next source when tiles keep failing. Light, interactive use only.
 */
const SOURCES: { url: (z: number, x: number, y: number) => string; attr: string }[] = [
  { url: (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.openstreetmap.fr/osmfr/${z}/${x}/${y}.png`, attr: '© OpenStreetMap France · © OpenStreetMap contributors' },
  { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`, attr: '© Esri · HERE, Garmin, OpenStreetMap contributors' },
  { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, attr: '© OpenStreetMap contributors' }
]

/** World pixel coordinates at zoom z. */
function project([lat, lng]: LatLng, z: number): [number, number] {
  const s = TILE * 2 ** z
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180
  return [((lng + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s]
}
function unproject([x, y]: [number, number], z: number): LatLng {
  const s = TILE * 2 ** z
  const lng = (x / s) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / s
  return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), ((lng + 540) % 360) - 180]
}

interface Props {
  center: LatLng
  zoom?: number
  a?: LatLng | null
  b?: LatLng | null
  here?: LatLng | null
  onPick: (p: LatLng) => void
  /** Called when the view moves (to remember it). */
  onView?: (center: LatLng, zoom: number) => void
  height?: number
}

export function MapPicker({ center, zoom = 14, a, b, here, onPick, onView, height = 320 }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 600, h: height })
  const [z, setZ] = useState(zoom)
  // View centre in world pixels at the current zoom.
  const [c, setC] = useState<[number, number]>(() => project(center, zoom))
  const drag = useRef<{ x: number; y: number; c: [number, number]; moved: boolean } | null>(null)
  const [src, setSrc] = useState(() => Number(localStorage.getItem('mapSource') ?? 0) % SOURCES.length)
  const fails = useRef(0)
  const loaded = useRef(0)
  const tileFailed = (): void => {
    // Several failures before any success = this source is blocked here: try the next one.
    if (++fails.current >= 3 && loaded.current === 0 && src < SOURCES.length - 1) {
      fails.current = 0
      setSrc(src + 1)
      localStorage.setItem('mapSource', String(src + 1))
    }
  }

  useLayoutEffect(() => {
    const el = box.current!
    const measure = (): void => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Fallbacks: panels resize via splitters / container queries and the observer can lag.
    window.addEventListener('resize', measure)
    el.addEventListener('pointerenter', measure)
    const t = setInterval(measure, 1000)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      el.removeEventListener('pointerenter', measure)
      clearInterval(t)
    }
  }, [])

  // External jumps (search result, preset place): recentre.
  const lastCenter = useRef(center.join(','))
  useEffect(() => {
    const k = center.join(',')
    if (k === lastCenter.current) return
    lastCenter.current = k
    setC(project(center, z))
  }, [center, z])

  useEffect(() => {
    const t = setTimeout(() => onView?.(unproject(c, z), z), 300)
    return () => clearTimeout(t)
  }, [c, z]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (nz: number, px?: number, py?: number): void => {
    nz = Math.max(MIN_Z, Math.min(MAX_Z, nz))
    if (nz === z) return
    // Keep the point under the cursor (or the centre) where it is.
    const ox = (px ?? size.w / 2) - size.w / 2
    const oy = (py ?? size.h / 2) - size.h / 2
    const f = 2 ** (nz - z)
    setC(([x, y]) => [(x + ox) * f - ox, (y + oy) * f - oy])
    setZ(nz)
  }

  const toScreen = (p: LatLng): [number, number] => {
    const [x, y] = project(p, z)
    return [x - c[0] + size.w / 2, y - c[1] + size.h / 2]
  }

  // Tiles covering the view.
  const n = 2 ** z
  const left = c[0] - size.w / 2
  const top = c[1] - size.h / 2
  const tiles: { key: string; src: string; x: number; y: number }[] = []
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx++) {
      const wx = ((tx % n) + n) % n
      tiles.push({ key: `${src}/${z}/${tx}/${ty}`, src: SOURCES[src].url(z, wx, ty), x: tx * TILE - left, y: ty * TILE - top })
    }
  }

  const onDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, c, moved: false }
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (d.moved) setC([d.c[0] - dx, d.c[1] - dy])
  }
  const onUp = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const r = box.current!.getBoundingClientRect()
    onPick(unproject([left + (e.clientX - r.left), top + (e.clientY - r.top)], z))
  }
  // Always zoom the map with the wheel and never scroll the page behind it. React's onWheel is
  // passive (preventDefault is ignored), so listen natively; the ref keeps the latest zoom state.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelRef.current = (e) => {
    const r = box.current!.getBoundingClientRect()
    zoomAt(z + (e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top)
  }
  useEffect(() => {
    const el = box.current!
    const h = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      wheelRef.current(e)
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  const pa = a ? toScreen(a) : null
  const pb = b ? toScreen(b) : null
  const ph = here ? toScreen(here) : null

  return (
    <div className="map" ref={box} style={{ height }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      {tiles.map((t) => (
        <img
          key={t.key}
          className="map-tile"
          src={t.src}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          style={{ left: t.x, top: t.y }}
          onLoad={() => loaded.current++}
          onError={tileFailed}
        />
      ))}
      <svg className="map-svg" width={size.w} height={size.h}>
        {pa && pb && <line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} className="map-route" />}
      </svg>
      {pa && <div className="map-pin a" style={{ left: pa[0], top: pa[1] }}><span>{b ? 'A' : ''}</span></div>}
      {pb && <div className="map-pin b" style={{ left: pb[0], top: pb[1] }}><span>B</span></div>}
      {ph && <div className="map-here" style={{ left: ph[0], top: ph[1] }} title="Vị trí giả hiện tại của điện thoại" />}
      <div className="map-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => zoomAt(z + 1)} title="Phóng to"><Plus size={13} /></button>
        <button onClick={() => zoomAt(z - 1)} title="Thu nhỏ"><Minus size={13} /></button>
      </div>
      <div className="map-attr" onPointerDown={(e) => e.stopPropagation()}>{SOURCES[src].attr}</div>
    </div>
  )
}
