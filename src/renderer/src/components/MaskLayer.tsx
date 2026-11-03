import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { finishMasks, type Mask } from '../lib/automation'

interface Props {
  initial: Mask[]
  /** Pixel box of the canvas inside the phone frame. */
  left: number
  top: number
  width: number
  height: number
}

const r3 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000

/**
 * Lets the tester drag rectangles over the mirrored screen: regions a visual check must
 * ignore (clock, date, greeting, ads…). Nothing is sent to the device while drawing.
 */
export function MaskLayer({ initial, left, top, width, height }: Props) {
  const [masks, setMasks] = useState<Mask[]>(initial)
  const [draft, setDraft] = useState<Mask | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const pos = (e: React.PointerEvent): { x: number; y: number } => {
    const b = ref.current!.getBoundingClientRect()
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }
  }
  const box = (a: { x: number; y: number }, b: { x: number; y: number }): Mask => [
    r3(Math.min(a.x, b.x)),
    r3(Math.min(a.y, b.y)),
    r3(Math.max(a.x, b.x)),
    r3(Math.max(a.y, b.y))
  ]
  const style = (m: Mask): React.CSSProperties => ({
    left: `${m[0] * 100}%`,
    top: `${m[1] * 100}%`,
    width: `${(m[2] - m[0]) * 100}%`,
    height: `${(m[3] - m[1]) * 100}%`
  })

  return (
    <div className="mask-layer" style={{ left, top, width, height }}>
      <div
        ref={ref}
        className="mask-draw"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.mask-x')) return
          try {
            e.currentTarget.setPointerCapture(e.pointerId) // keep the drag even outside the screen
          } catch {
            /* not capturable (e.g. synthetic pointer) — drawing still works */
          }
          start.current = pos(e)
          setDraft(box(start.current, start.current))
        }}
        onPointerMove={(e) => start.current && setDraft(box(start.current, pos(e)))}
        onPointerUp={(e) => {
          if (!start.current) return
          const m = box(start.current, pos(e))
          start.current = null
          setDraft(null)
          if (m[2] - m[0] > 0.01 && m[3] - m[1] > 0.005) setMasks((l) => [...l, m])
        }}
      >
        {masks.map((m, i) => (
          <div key={i} className="mask-rect" style={style(m)}>
            <button className="mask-x" title="Bỏ vùng này" onClick={() => setMasks((l) => l.filter((_, k) => k !== i))}>
              <X size={10} />
            </button>
          </div>
        ))}
        {draft && <div className="mask-rect draft" style={style(draft)} />}
      </div>
      <div className="mask-bar">
        <span>Kéo chuột để khoanh vùng bỏ qua khi so sánh ({masks.length})</span>
        <button className="iconbtn" onClick={() => setMasks([])}>Xóa hết</button>
        <button className="iconbtn" onClick={() => finishMasks(null)}>Hủy</button>
        <button className="iconbtn primary" onClick={() => finishMasks(masks)}>Xong</button>
      </div>
    </div>
  )
}
