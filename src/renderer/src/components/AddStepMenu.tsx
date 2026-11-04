import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { ADD_META, CAT_INFO, CAT_ORDER, type StepCat } from '../lib/stepMeta'

interface Item {
  key: string
  label: string
  hint: string
  cat: StepCat
  popular?: boolean
  icon: React.ReactNode
}

/**
 * "+ Thêm bước": a grouped, searchable menu instead of one long native list. Groups say what the
 * step is for; each entry has a one-line hint; type to filter, ↑/↓ + Enter to pick, Esc to close.
 */
export function AddStepMenu({
  keys,
  iconOf,
  disabled,
  onPick,
  primary
}: {
  /** Keys of the steps that can be added (ADDABLE in AutomationPanel). */
  keys: string[]
  iconOf: (key: string) => React.ReactNode
  disabled?: boolean
  onPick: (key: string) => void
  primary?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const items: Item[] = useMemo(
    () => keys.filter((k) => ADD_META[k]).map((k) => ({ key: k, ...ADD_META[k], icon: iconOf(k) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys]
  )
  const s = q.trim().toLowerCase()
  const shown = s ? items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(s)) : items
  const popular = !s ? items.filter((i) => i.popular) : []
  // Flat order the keyboard walks through: popular first (when not searching), then groups.
  const flat: Item[] = [...popular, ...CAT_ORDER.flatMap((c) => shown.filter((i) => i.cat === c))]

  useEffect(() => {
    if (!open) return
    setQ('')
    setCur(0)
    const t = setTimeout(() => input.current?.focus(), 30)
    const h = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', h)
    }
  }, [open])
  useEffect(() => setCur(0), [q])
  useEffect(() => {
    root.current?.querySelector('.asm-item.cur')?.scrollIntoView({ block: 'nearest' })
  }, [cur, open])

  const pick = (key: string): void => {
    setOpen(false)
    onPick(key)
  }

  const row = (i: Item, idx: number, prefix: string): React.ReactNode => (
    <button key={prefix + i.key} className={`asm-item ${cur === idx ? 'cur' : ''}`} onMouseEnter={() => setCur(idx)} onClick={() => pick(i.key)}>
      <span className={`asm-ico c-${i.cat}`}>{i.icon}</span>
      <span className="asm-txt">
        <span className="asm-name">{i.label}</span>
        <span className="asm-hint">{i.hint}</span>
      </span>
    </button>
  )

  let idx = 0
  return (
    <div className="asm-wrap" ref={root}>
      <button className={`iconbtn ${primary ? 'primary' : ''}`} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Thêm một bước vào kịch bản (sau bước đang chọn)">
        <Plus size={14} /> Thêm bước
      </button>
      {open && (
        <div
          className="asm-pop"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCur((c) => Math.min(flat.length - 1, c + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCur((c) => Math.max(0, c - 1))
            } else if (e.key === 'Enter' && flat[cur]) {
              e.preventDefault()
              pick(flat[cur].key)
            }
          }}
        >
          <div className="asm-search">
            <Search size={13} />
            <input ref={input} className="input" placeholder="Tìm bước: chờ, kiểm tra, OTP, quyền…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="asm-list">
            {flat.length === 0 && <div className="asm-empty">Không có bước nào khớp “{q}”.</div>}
            {popular.length > 0 && (
              <div className="asm-group">
                <div className="asm-cap">Hay dùng</div>
                {popular.map((i) => row(i, idx++, 'p-'))}
              </div>
            )}
            {CAT_ORDER.map((c) => {
              const list = shown.filter((i) => i.cat === c)
              if (!list.length) return null
              return (
                <div key={c} className="asm-group">
                  <div className="asm-cap">
                    {CAT_INFO[c].title} <span>{CAT_INFO[c].hint}</span>
                  </div>
                  {list.map((i) => row(i, idx++, 'c-'))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
