import { useRef } from 'react'

/**
 * Vertical drag handle between two columns. Reports the horizontal movement since the
 * drag started, so the owner can resize from the width it had at that moment.
 */
export function Splitter({
  onStart,
  onDrag,
  onEnd,
  onReset,
  title
}: {
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd?: () => void
  onReset?: () => void
  title?: string
}) {
  const startX = useRef<number | null>(null)
  return (
    <div
      className="splitter"
      title={title ?? 'Kéo để đổi độ rộng · bấm đúp để về mặc định'}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        startX.current = e.clientX
        document.body.classList.add('resizing')
        onStart()
      }}
      onPointerMove={(e) => {
        if (startX.current !== null) onDrag(e.clientX - startX.current)
      }}
      onPointerUp={() => {
        startX.current = null
        document.body.classList.remove('resizing')
        onEnd?.()
      }}
      onPointerCancel={() => {
        startX.current = null
        document.body.classList.remove('resizing')
      }}
    />
  )
}
