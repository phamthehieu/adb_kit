import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'

type Axis = 'x' | 'y'
/** normal = both panes; hidden = the resized pane is closed; max = the other pane is closed. */
type Mode = 'normal' | 'hidden' | 'max'

const MIN = 60
const KEEP = 80 // room always left for the other pane

const keyOf = (id: string, axis: Axis): string => `pane:${id}:${axis}`
const modeKey = (id: string): string => `pane:${id}:mode`

function stored(id: string, axis: Axis): number | null {
  const v = Number(localStorage.getItem(keyOf(id, axis)))
  return Number.isFinite(v) && v > 0 ? v : null
}
function storedMode(id: string): Mode {
  const v = localStorage.getItem(modeKey(id))
  return v === 'hidden' || v === 'max' ? v : 'normal'
}

/**
 * Drag handle between two stacked (or side-by-side) panes inside a flex container.
 * It resizes its previous or next sibling, follows the container's flex-direction
 * (so the same handle works when a container query turns columns into rows), and
 * remembers the size per axis. Double-click returns to the CSS default.
 * The two small buttons close either pane so the other gets the whole area.
 * The panes must not take a React `style` prop.
 */
export function PaneHandle({ id, target = 'next', title }: { id: string; target?: 'prev' | 'next'; title?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ start: number; size: number; axis: Axis } | null>(null)
  const [axis, setAxis] = useState<Axis>('y')
  const [mode, setModeState] = useState<Mode>(() => storedMode(id))
  const modeRef = useRef(mode)

  const pane = (): HTMLElement | null =>
    (target === 'next' ? ref.current?.nextElementSibling : ref.current?.previousElementSibling) as HTMLElement | null
  const peer = (): HTMLElement | null =>
    (target === 'next' ? ref.current?.previousElementSibling : ref.current?.nextElementSibling) as HTMLElement | null
  const axisOf = (): Axis => {
    const p = ref.current?.parentElement
    return p && getComputedStyle(p).flexDirection.startsWith('column') ? 'y' : 'x'
  }
  const limit = (px: number, ax: Axis): number => {
    const p = ref.current?.parentElement
    const total = p ? (ax === 'y' ? p.clientHeight : p.clientWidth) : 0
    const max = total > 0 ? Math.max(MIN, total - KEEP) : px
    return Math.round(Math.min(max, Math.max(MIN, px)))
  }
  const size = (px: number | null, ax: Axis): void => {
    const el = pane()
    if (!el) return
    if (px === null) {
      el.style.flex = ''
      el.style.maxHeight = ''
      el.style.maxWidth = ''
      el.style.height = ''
      return
    }
    el.style.flex = `0 0 ${px}px`
    el.style.height = ax === 'y' ? `${px}px` : ''
    el.style.maxHeight = ax === 'y' ? 'none' : ''
    el.style.maxWidth = ax === 'x' ? 'none' : ''
  }
  /** Puts the panes in the state `m` describes, for axis `ax`. */
  const layout = (m: Mode, ax: Axis): void => {
    const el = pane()
    const other = peer()
    if (!el) return
    el.style.display = m === 'hidden' ? 'none' : ''
    if (other) other.style.display = m === 'max' ? 'none' : ''
    if (m === 'max') {
      el.style.flex = '1 1 auto'
      el.style.height = ''
      el.style.maxHeight = 'none'
      el.style.maxWidth = 'none'
    } else {
      const v = stored(id, ax)
      size(v === null ? null : limit(v, ax), ax)
    }
  }
  const setMode = (m: Mode): void => {
    modeRef.current = m
    setModeState(m)
    if (m === 'normal') localStorage.removeItem(modeKey(id))
    else localStorage.setItem(modeKey(id), m)
    layout(m, axisOf())
  }

  useLayoutEffect(() => {
    const h = ref.current
    const parent = h?.parentElement
    if (!h || !parent) return
    let last: Axis | null = null
    const sync = (): void => {
      if (drag.current) return
      const ax = axisOf()
      h.dataset.axis = ax
      if (ax !== last) {
        last = ax
        setAxis(ax)
        layout(modeRef.current, ax)
      }
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(parent)
    return () => {
      ro.disconnect()
      // Leave nothing hidden behind if this handle goes away (e.g. detail closed).
      const other = peer()
      if (other) other.style.display = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, target])

  const end = (): void => {
    drag.current = null
    document.body.classList.remove('resizing', 'resizing-y')
  }

  // Arrow pointing where the pane edge moves: toward the pane closes it, away from it grows it.
  const toward = axis === 'y' ? (target === 'next' ? ChevronDown : ChevronUp) : target === 'next' ? ChevronRight : ChevronLeft
  const away = axis === 'y' ? (target === 'next' ? ChevronUp : ChevronDown) : target === 'next' ? ChevronLeft : ChevronRight
  const Close = toward
  const Grow = away
  const side = (next: boolean): string => (axis === 'y' ? (next ? 'dưới' : 'trên') : next ? 'phải' : 'trái')
  const mine = side(target === 'next')
  const theirs = side(target !== 'next')
  const stop = (e: React.PointerEvent): void => e.stopPropagation()

  return (
    <div
      ref={ref}
      className={`pane-handle ${mode !== 'normal' ? 'folded' : ''}`}
      title={title ?? 'Kéo để đổi kích thước · bấm đúp để về mặc định'}
      onDoubleClick={() => {
        const ax = axisOf()
        localStorage.removeItem(keyOf(id, ax))
        if (modeRef.current !== 'normal') setMode('normal')
        else size(null, ax)
      }}
      onPointerDown={(e) => {
        const el = pane()
        if (!el || e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const ax = axisOf()
        if (modeRef.current !== 'normal') setMode('normal')
        const r = el.getBoundingClientRect()
        drag.current = { start: ax === 'y' ? e.clientY : e.clientX, size: ax === 'y' ? r.height : r.width, axis: ax }
        document.body.classList.add(ax === 'y' ? 'resizing-y' : 'resizing')
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const delta = (d.axis === 'y' ? e.clientY : e.clientX) - d.start
        // Dragging toward the pane shrinks it.
        const px = limit(d.size + (target === 'next' ? -delta : delta), d.axis)
        size(px, d.axis)
        localStorage.setItem(keyOf(id, d.axis), String(px))
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="ph-btns" onPointerDown={stop} onDoubleClick={(e) => e.stopPropagation()}>
        {mode !== 'max' && (
          <button
            className="ph-btn"
            title={mode === 'hidden' ? `Mở lại khung ${mine}` : `Ẩn khung ${theirs} để khung ${mine} chiếm hết chỗ`}
            onClick={() => setMode(mode === 'hidden' ? 'normal' : 'max')}
          >
            <Grow size={12} />
          </button>
        )}
        {mode !== 'hidden' && (
          <button
            className="ph-btn"
            title={mode === 'max' ? `Mở lại khung ${theirs}` : `Ẩn khung ${mine} để khung ${theirs} chiếm hết chỗ`}
            onClick={() => setMode(mode === 'max' ? 'normal' : 'hidden')}
          >
            <Close size={12} />
          </button>
        )}
      </span>
    </div>
  )
}
