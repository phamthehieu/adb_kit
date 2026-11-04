import { useEffect, useRef, useState } from 'react'
import { CircleHelp, Info, TriangleAlert } from 'lucide-react'
import { reducedMotion } from './motion'

/**
 * In-app replacement for window.confirm / alert: same dark look as the rest of the app, the
 * safe button is focused for destructive questions, Esc cancels, and the text can be long.
 */
export interface AskOptions {
  /** Window title; defaults to "Xác nhận" / "Thông báo". */
  title?: string
  /** Label of the confirming button. */
  ok?: string
  cancel?: string
  /** Destructive action: red confirm button, "Hủy" focused first. */
  danger?: boolean
}

interface Request {
  kind: 'ask' | 'tell'
  message: string
  opts: AskOptions
  resolve: (ok: boolean) => void
}

let enqueue: ((r: Request) => void) | null = null

/** Ask a yes/no question. Resolves true when the user confirms. */
export function ask(message: string, opts: AskOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    // No host mounted (should not happen in the app): fall back to the system dialog.
    if (!enqueue) return resolve(window.confirm(message))
    enqueue({ kind: 'ask', message, opts, resolve })
  })
}

/** Show a message with a single "Đóng" button. */
export function tell(message: string, opts: AskOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!enqueue) {
      window.alert(message)
      return resolve()
    }
    enqueue({ kind: 'tell', message, opts, resolve: () => resolve() })
  })
}

/** First paragraph = the question, the rest = details. */
function split(message: string): [string, string] {
  const i = message.indexOf('\n\n')
  return i < 0 ? [message, ''] : [message.slice(0, i), message.slice(i + 2)]
}

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([])
  const [closing, setClosing] = useState(false)
  const okRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restore = useRef<HTMLElement | null>(null)
  const cur = queue[0]

  useEffect(() => {
    enqueue = (r) => setQueue((q) => [...q, r])
    return () => {
      enqueue = null
    }
  }, [])

  // Focus the safe choice when a dialog opens, give focus back when the last one closes.
  useEffect(() => {
    if (!cur) {
      restore.current?.focus?.()
      restore.current = null
      return
    }
    restore.current ??= document.activeElement as HTMLElement | null
    ;(cur.kind === 'ask' && cur.opts.danger ? cancelRef.current : okRef.current)?.focus()
  }, [cur])

  if (!cur) return null
  const close = (ok: boolean): void => {
    if (closing) return
    cur.resolve(ok) // the caller continues right away; the window just fades out behind it
    if (reducedMotion()) return setQueue((q) => q.slice(1))
    setClosing(true)
    window.setTimeout(() => {
      setClosing(false)
      setQueue((q) => q.slice(1))
    }, 120)
  }
  const [head, body] = split(cur.message)
  const danger = cur.kind === 'ask' && cur.opts.danger
  const Icon = danger ? TriangleAlert : cur.kind === 'tell' ? Info : CircleHelp
  const title = cur.opts.title ?? (cur.kind === 'tell' ? 'Thông báo' : danger ? 'Cần xác nhận' : 'Xác nhận')

  return (
    <div
      className={`dlg-backdrop ${closing ? 'out' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && cur.kind === 'tell') close(true)
      }}
    >
      <div
        className="dlg"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close(false)
          } else if (e.key === 'Tab') {
            // Keep focus inside the dialog.
            const btns = [cancelRef.current, okRef.current].filter(Boolean) as HTMLButtonElement[]
            const i = btns.indexOf(document.activeElement as HTMLButtonElement)
            e.preventDefault()
            btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length]?.focus()
          }
        }}
      >
        <div className={`dlg-ico ${danger ? 'danger' : ''}`}>
          <Icon size={22} />
        </div>
        <div className="dlg-main">
          <div className="dlg-title">{title}</div>
          <div className="dlg-head">{head}</div>
          {body && <div className="dlg-body">{body}</div>}
        </div>
        <div className="dlg-actions">
          {cur.kind === 'ask' && (
            <button ref={cancelRef} className="iconbtn dlg-btn" onClick={() => close(false)}>
              {cur.opts.cancel ?? 'Hủy'}
            </button>
          )}
          <button ref={okRef} className={`iconbtn dlg-btn ${danger ? 'danger-solid' : 'primary'}`} onClick={() => close(true)}>
            {cur.kind === 'tell' ? (cur.opts.ok ?? 'Đóng') : (cur.opts.ok ?? 'Đồng ý')}
          </button>
        </div>
      </div>
    </div>
  )
}
