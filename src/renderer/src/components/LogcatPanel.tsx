import { useEffect, useMemo, useRef, useState } from 'react'
import { PackagePicker } from './PackagePicker'
import { ArrowDownToLine, CaseSensitive, Eraser, Pause, Play, Regex } from 'lucide-react'

interface Entry {
  time: string
  pid: number
  tid: number
  level: string
  tag: string
  msg: string
}

const LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'] as const
const LEVEL_NAMES: Record<string, string> = { V: 'Verbose', D: 'Debug', I: 'Info', W: 'Warn', E: 'Error', F: 'Fatal' }
const MAX = 60_000
const ROW_H = 18
// "11-02 08:29:33.525  6730  6730 W Gralloc3: mapper 3.x is not supported"
const RE = /^\d\d-\d\d (\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+) ([VDIWEFS]) (.*?)\s*: ?(.*)$/

function parse(line: string, prev: Entry | undefined): Entry {
  const m = RE.exec(line)
  if (m) return { time: m[1], pid: +m[2], tid: +m[3], level: m[4], tag: m[5], msg: m[6] }
  return { time: prev?.time ?? '', pid: prev?.pid ?? 0, tid: prev?.tid ?? 0, level: prev?.level ?? 'I', tag: prev?.tag ?? '', msg: line }
}

export function LogcatPanel({ serial }: { serial: string }) {
  const all = useRef<Entry[]>([])
  const [version, setVersion] = useState(0)
  const [paused, setPaused] = useState(false)
  const [minLevel, setMinLevel] = useState('V')
  const [query, setQuery] = useState('')
  const [caseSens, setCaseSens] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [pkg, setPkg] = useState('')
  const [pids, setPids] = useState<number[] | null>(null)
  const [follow, setFollow] = useState(true)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(400)
  const viewRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // Stream
  useEffect(() => {
    all.current = []
    setVersion((v) => v + 1)
    const off = window.api.logcat.onLines((lines) => {
      if (pausedRef.current) return
      const arr = all.current
      for (const l of lines) arr.push(parse(l, arr[arr.length - 1]))
      if (arr.length > MAX) arr.splice(0, arr.length - MAX + 5000)
      setVersion((v) => v + 1)
    })
    void window.api.logcat.start(serial)
    return () => {
      off()
      void window.api.logcat.stop()
    }
  }, [serial])

  // App filter: resolve the package to PIDs, refreshed so app restarts are followed.
  useEffect(() => {
    if (!pkg) return setPids(null)
    let alive = true
    const tick = (): void => {
      void window.api.apps.pids(serial, pkg).then((p) => alive && setPids(p))
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [serial, pkg])

  const matcher = useMemo(() => {
    if (!query) return null
    try {
      return new RegExp(useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSens ? 'g' : 'gi')
    } catch {
      return undefined // invalid regex
    }
  }, [query, caseSens, useRegex])

  const rows = useMemo(() => {
    const min = LEVELS.indexOf(minLevel as (typeof LEVELS)[number])
    const pidSet = pids ? new Set(pids) : null
    return all.current.filter((e) => {
      if (LEVELS.indexOf(e.level as (typeof LEVELS)[number]) < min) return false
      if (pidSet && !pidSet.has(e.pid)) return false
      if (matcher) {
        matcher.lastIndex = 0
        if (!matcher.test(e.tag + ' ' + e.msg)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, minLevel, matcher, pids])

  // Keep pinned to the bottom while following.
  useEffect(() => {
    const v = viewRef.current
    if (v && follow) v.scrollTop = v.scrollHeight
  }, [rows, follow])

  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    const ro = new ResizeObserver(() => setViewH(v.clientHeight))
    ro.observe(v)
    return () => ro.disconnect()
  }, [])

  const onScroll = (): void => {
    const v = viewRef.current!
    setScrollTop(v.scrollTop)
    const atBottom = v.scrollHeight - v.scrollTop - v.clientHeight < ROW_H * 2
    if (atBottom !== follow) setFollow(atBottom)
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 10)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 10)
  const visible = rows.slice(start, end)

  const highlight = (s: string): React.ReactNode => {
    if (!matcher) return s
    const parts: React.ReactNode[] = []
    let last = 0
    matcher.lastIndex = 0
    for (let m = matcher.exec(s); m; m = matcher.exec(s)) {
      if (m[0] === '') {
        matcher.lastIndex++
        continue
      }
      parts.push(s.slice(last, m.index), <mark key={m.index}>{m[0]}</mark>)
      last = m.index + m[0].length
    }
    parts.push(s.slice(last))
    return parts
  }

  const clear = (): void => {
    all.current = []
    setVersion((v) => v + 1)
    void window.api.logcat.clear(serial)
  }

  return (
    <div className="panel wide">
      <div className="log-tools">
        <select className="input" value={minLevel} onChange={(e) => setMinLevel(e.target.value)} title="Mức log tối thiểu">
          {LEVELS.map((l) => (
            <option key={l} value={l}>{LEVEL_NAMES[l]}</option>
          ))}
        </select>
        <input
          className="input search"
          placeholder="Tìm trong nội dung hoặc tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={matcher === undefined ? { borderColor: 'var(--err)' } : undefined}
        />
        <button className={`iconbtn ${caseSens ? 'on' : ''}`} title="Phân biệt hoa thường" onClick={() => setCaseSens(!caseSens)}><CaseSensitive size={15} /></button>
        <button className={`iconbtn ${useRegex ? 'on' : ''}`} title="Biểu thức chính quy (regex)" onClick={() => setUseRegex(!useRegex)}><Regex size={14} /></button>
        <PackagePicker serial={serial} placeholder="Lọc theo app…" value={pkg} onChange={setPkg} style={{ width: 220 }} />
        <button className={`iconbtn ${paused ? 'on' : ''}`} onClick={() => setPaused(!paused)}>
          {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Tiếp tục' : 'Tạm dừng'}
        </button>
        <button className="iconbtn" title="Xóa log trên thiết bị" onClick={clear}><Eraser size={14} /></button>
        <button className={`iconbtn ${follow ? 'on' : ''}`} title="Tự cuộn theo log mới" onClick={() => setFollow(true)}><ArrowDownToLine size={14} /></button>
      </div>
      <div className="log-meta">
        <span>hiển thị {rows.length.toLocaleString()} / {all.current.length.toLocaleString()} dòng</span>
        {pkg && <span>{pids?.length ? `PID ${pids.join(', ')}` : 'app chưa chạy'}</span>}
        {paused && <span style={{ color: 'var(--warn)' }}>đang tạm dừng — log mới bị bỏ qua</span>}
      </div>
      <div className="log-view" ref={viewRef} onScroll={onScroll}>
        <div style={{ height: rows.length * ROW_H }} />
        {visible.map((e, i) => (
          <div key={start + i} className={`log-row ${e.level}`} style={{ top: (start + i) * ROW_H }}>
            <span className="t">{e.time}</span>
            <span className="p">{e.pid} {e.tid}</span>
            <span className={`l lv-${e.level}`}>{e.level}</span>
            <span className="g" title={e.tag}>{highlight(e.tag)}</span>
            <span className="m">{highlight(e.msg)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
