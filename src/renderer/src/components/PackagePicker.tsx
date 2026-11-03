import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

// Package lists are cached per device for the session (pm list is ~0.5 s).
const cache = new Map<string, Promise<{ all: string[]; user: string[] }>>()
function catalog(serial: string): Promise<{ all: string[]; user: string[] }> {
  let p = cache.get(serial)
  if (!p) {
    p = window.api.apps.catalog(serial).catch(() => ({ all: [], user: [] }))
    cache.set(serial, p)
  }
  return p
}

interface Props {
  serial: string
  value: string
  onChange: (pkg: string) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}

type Item = { pkg: string; group: 'Đang mở' | 'App đã cài' | 'Hệ thống' }

const MAX_ITEMS = 300

/**
 * Package combobox styled like the app (the native <datalist> popup is white,
 * unstyleable and scrolls badly). Type to filter; ↑/↓/Enter/Esc to navigate.
 */
export function PackagePicker({ serial, value, onChange, placeholder, className, style }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [lists, setLists] = useState<{ all: string[]; user: string[] }>({ all: [], user: [] })
  const [front, setFront] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const show = (): void => {
    setQuery('')
    setActive(0)
    setOpen(true)
    void catalog(serial).then(setLists)
    void window.api.apps.foreground(serial).then(setFront).catch(() => setFront(null))
  }

  // Close when clicking elsewhere.
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node) && !listRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  // The popup is position:fixed so scrollable parents can't clip it; keep it glued to the input.
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => setRect(wrapRef.current?.getBoundingClientRect() ?? null)
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const hit = (p: string): boolean => !q || p.toLowerCase().includes(q)
    const user = new Set(lists.user)
    const out: Item[] = []
    if (front && hit(front)) out.push({ pkg: front, group: 'Đang mở' })
    for (const p of lists.user) if (p !== front && hit(p)) out.push({ pkg: p, group: 'App đã cài' })
    for (const p of lists.all) if (!user.has(p) && p !== front && hit(p)) out.push({ pkg: p, group: 'Hệ thống' })
    return out.slice(0, MAX_ITEMS)
  }, [query, lists, front])

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (pkg: string): void => {
    onChange(pkg)
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'ArrowDown') show()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(items.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[active]) pick(items[active].pkg)
      else if (query.trim()) pick(query.trim())
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const below = rect ? window.innerHeight - rect.bottom : 0
  const up = rect ? below < 240 && rect.top > below : false
  const maxH = rect ? Math.min(340, Math.max(120, (up ? rect.top : below) - 12)) : 300

  return (
    <div className={`pkg-picker ${className ?? ''}`} style={style} ref={wrapRef}>
      <input
        ref={inputRef}
        className="input"
        placeholder={placeholder}
        value={open ? query : value}
        onFocus={show}
        onClick={(e) => {
          e.stopPropagation()
          if (!open) show()
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          if (!open) setOpen(true)
        }}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {value && !open ? (
        <button className="pkg-btn" title="Xóa" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); onChange('') }}>
          <X size={12} />
        </button>
      ) : (
        <span className="pkg-btn"><ChevronDown size={12} /></span>
      )}
      {open && rect && (
        <div
          ref={listRef}
          className="pkg-pop"
          style={{
            left: rect.left,
            width: Math.max(rect.width, 280),
            maxHeight: maxH,
            ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 })
          }}
          onMouseDown={(e) => e.preventDefault()} // keep focus in the input
        >
          {items.length === 0 && (
            <div className="pkg-empty">
              {lists.all.length ? (query ? `Không có app nào khớp “${query}” — Enter để dùng luôn` : 'Không có app') : 'Đang tải danh sách app…'}
            </div>
          )}
          {items.map((it, i) => (
            <div key={it.group + it.pkg}>
              {(i === 0 || items[i - 1].group !== it.group) && <div className="pkg-group">{it.group}</div>}
              <div
                data-i={i}
                className={`pkg-item ${i === active ? 'active' : ''} ${it.pkg === value ? 'cur' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={(e) => {
                  e.stopPropagation()
                  pick(it.pkg)
                }}
              >
                {it.pkg}
              </div>
            </div>
          ))}
          {items.length === MAX_ITEMS && <div className="pkg-empty">Gõ để lọc bớt…</div>}
        </div>
      )}
    </div>
  )
}
