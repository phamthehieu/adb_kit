import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { HelpPanel, Target, TourStep } from '../lib/help'

function find(t: Target | undefined): HTMLElement | null {
  if (!t) return null
  if (typeof t === 'string') return document.querySelector<HTMLElement>(t)
  const root = t.within ? document.querySelector(t.within) : document
  if (!root) return null
  const want = t.text.toLowerCase()
  const els = [...root.querySelectorAll<HTMLElement>('button, label, select, a')]
  // Prefer an exact label, then one that contains the text.
  return els.find((e) => e.textContent?.trim().toLowerCase() === want) ?? els.find((e) => e.textContent?.toLowerCase().includes(want)) ?? null
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Guided tour: dims the window, cuts a bright hole around the element of each step and shows
 * an explanation next to it. Steps can open a panel first; a missing element (e.g. no phone
 * connected) just shows the explanation in the middle.
 */
export function Tour({ steps, onPanel, onClose }: { steps: TourStep[]; onPanel: (p: HelpPanel) => void; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [searching, setSearching] = useState(true)
  const bubble = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const step = steps[i]

  // Open the step's panel, then wait (≤ 1.5 s) for its element to appear; follow it every frame
  // (panels open, layouts settle, the window can be resized while the tour is shown).
  useEffect(() => {
    if (step.panel) onPanel(step.panel)
    setSearching(true)
    setBox(null)
    const started = performance.now()
    let scrolled = false
    let raf = 0
    const loop = (): void => {
      const el = find(step.target)
      if (el) {
        let r = el.getBoundingClientRect()
        // Only scroll when the element is really off screen (e.g. inside a long panel).
        if (!scrolled && (r.bottom > window.innerHeight || r.top < 0)) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' })
          r = el.getBoundingClientRect()
        }
        scrolled = true
        setBox((b) => (b && b.x === r.left && b.y === r.top && b.w === r.width && b.h === r.height ? b : { x: r.left, y: r.top, w: r.width, h: r.height }))
        setSearching(false)
      } else if (performance.now() - started > 1500) {
        setBox(null)
        setSearching(false)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps

  // Place the bubble below the element, else above, else beside; always on screen.
  useLayoutEffect(() => {
    const b = bubble.current
    if (!b) return
    const bw = b.offsetWidth
    const bh = b.offsetHeight
    const W = window.innerWidth
    const H = window.innerHeight
    const m = 12
    if (!box) return setPos({ left: (W - bw) / 2, top: (H - bh) / 2 })
    let left = box.x + box.w / 2 - bw / 2
    let top = box.y + box.h + m
    if (top + bh > H - m) top = box.y - bh - m
    if (top < m) {
      // Not enough room above or below (tall element): put it beside.
      top = Math.min(H - bh - m, Math.max(m, box.y))
      left = box.x + box.w + m + bw < W ? box.x + box.w + m : box.x - bw - m
    }
    setPos({ left: Math.max(m, Math.min(W - bw - m, left)), top: Math.max(m, Math.min(H - bh - m, top)) })
  }, [box, i, searching])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const next = (): void => (i + 1 < steps.length ? setI(i + 1) : onClose())
  const pad = 6

  return (
    <div className="tour">
      {box ? (
        <div className="tour-hole" style={{ left: box.x - pad, top: box.y - pad, width: box.w + 2 * pad, height: box.h + 2 * pad }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-catch" onMouseDown={(e) => e.preventDefault()} />
      <div className="tour-bubble" ref={bubble} style={{ left: pos.left, top: pos.top, visibility: searching ? 'hidden' : 'visible' }}>
        <div className="tour-top">
          <b>{step.title}</b>
          <span className="muted">
            {i + 1}/{steps.length}
          </span>
          <span className="spacer" />
          <button className="iconbtn ghost" onClick={onClose} title="Đóng (Esc)"><X size={13} /></button>
        </div>
        <div className="tour-body">{step.body}</div>
        {!box && step.target && <div className="tour-miss muted">(Phần này chưa hiện — có thể cần kết nối điện thoại trước.)</div>}
        <div className="tour-nav">
          <button className="iconbtn ghost" onClick={onClose}>Bỏ qua</button>
          <span className="spacer" />
          <button className="iconbtn" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={13} /> Trước</button>
          <button className="iconbtn primary" onClick={next}>
            {i + 1 < steps.length ? <>Tiếp <ChevronRight size={13} /></> : 'Xong'}
          </button>
        </div>
      </div>
    </div>
  )
}
