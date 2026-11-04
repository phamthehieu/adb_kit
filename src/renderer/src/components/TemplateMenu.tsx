import { useEffect, useRef, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { TEMPLATES, type Template } from '../lib/templates'

/** "Mẫu có sẵn": drop a ready-made situation (offline, app killed, rotate…) into the script in one click. */
export function TemplateMenu({ disabled, onPick, primary }: { disabled?: boolean; onPick: (t: Template) => void; primary?: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('keydown', k)
    }
  }, [open])

  return (
    <div className="asm-wrap" ref={root}>
      <button className={`iconbtn ${primary ? 'primary' : ''}`} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Chèn một tình huống dựng sẵn: mất mạng, app bị giết, xoay màn hình…">
        <LayoutTemplate size={14} /> Mẫu có sẵn
      </button>
      {open && (
        <div className="asm-pop tpl-pop" role="menu">
          <div className="asm-list">
            <div className="asm-group">
              <div className="asm-cap">
                Tình huống thường gặp <span>chèn nhiều bước một lúc</span>
              </div>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className="asm-item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    onPick(t)
                  }}
                >
                  <span className="asm-txt">
                    <span className="asm-name">{t.title}</span>
                    <span className="asm-hint">{t.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
