import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  ClipboardPaste,
  Image as ImageIcon,
  KeyRound,
  Link2,
  ListTree,
  Loader2,
  LocateFixed,
  MousePointerClick,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Search,
  Sliders,
  Smartphone,
  Trash2,
  Upload
} from 'lucide-react'
import type { FPage, FPageRef, FScreen } from '@shared/figma'
import { parseFigmaUrl } from '@shared/figma'
import { autoStore, onAction, onInspect, useAutoState } from '../lib/automation'
import {
  appAt,
  appLabel,
  figmaAt,
  figmaLabel,
  matchFigma,
  measureApp,
  measureFigma,
  measurePair,
  suggestScreens,
  toAppEls,
  type AppEl,
  type Match,
  type Measure
} from '../lib/figmaMeasure'
import { Splitter } from './Splitter'

interface Dump {
  els: AppEl[]
  w: number
  h: number
}

const LS_URL = 'figma.url'
const LS_TOL = 'figma.tol'
const LS_VIEW_W = 'figma.viewW'
/** Padding around the frame inside its column (px). */
const PAD = 14
/** A cached UI dump is trusted for this long when nothing was sent to the phone. */
const LIVE_MAX_AGE = 6000

/**
 * Design check against Figma. "Theo dõi" turns the mirrored phone into a pointer: clicks
 * are not sent to the app (Alt + click is), the element under the cursor is outlined on
 * both sides and measured, and the Figma frame follows the screen shown on the phone.
 */
export function FigmaPanel({ serial }: { serial: string }) {
  const auto = useAutoState()
  const follow = auto.inspecting
  const [hasToken, setHasToken] = useState<boolean | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [url, setUrl] = useState(() => localStorage.getItem(LS_URL) ?? '')
  const [pages, setPages] = useState<FPageRef[]>([])
  const [page, setPage] = useState<FPage | null>(null)
  const [screenId, setScreenId] = useState<string>('')
  const [img, setImg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dump, setDump] = useState<Dump | null>(null)
  const [appSel, setAppSel] = useState(-1)
  const [figSel, setFigSel] = useState<Match | null>(null)
  const [suggest, setSuggest] = useState<{ idx: number; score: number }[]>([])
  const [tol, setTol] = useState(() => Number(localStorage.getItem(LS_TOL) ?? 2))
  const [filter, setFilter] = useState('')
  const [liveState, setLiveState] = useState<'reading' | 'ready' | 'failed'>('reading')
  const [pulse, setPulse] = useState(0)
  const density = useRef<number>(0)

  /* ------------------------------------------------------------ tabs & paste mode */

  const [tab, setTab] = useState<'url' | 'paste'>('url')
  const [pasted, setPasted] = useState<{ url: string; rawW: number; rawH: number; scale: number } | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pastedScreen: FScreen | null = useMemo(() => {
    if (!pasted) return null
    const w = Math.round(pasted.rawW / pasted.scale)
    const h = Math.round(pasted.rawH / pasted.scale)
    return {
      id: 'pasted-frame',
      name: `Ảnh dán (${pasted.rawW}×${pasted.rawH} px)`,
      section: 'Tự dán',
      w,
      h,
      nodes: []
    }
  }, [pasted])

  const screen: FScreen | null = tab === 'paste' ? pastedScreen : (page?.screens.find((s) => s.id === screenId) ?? null)
  const effImg: string | null = tab === 'paste' ? (pasted?.url ?? null) : img

  const [isFitted, setIsFitted] = useState(false)
  const [deviceDp, setDeviceDp] = useState<{ w: number; h: number } | null>(null)
  const [fitNote, setFitNote] = useState<string | null>(null)

  /* ------------------------------------------------------------ element list */

  const [infoMode, setInfoMode] = useState<'detail' | 'list'>('detail')
  const [elSearch, setElSearch] = useState('')
  const [elFilter, setElFilter] = useState<'all' | 'btn' | 'text' | 'input' | 'img'>('all')

  const parsedEls = useMemo(() => {
    if (!dump) return []
    return dump.els.map((el, originalIndex) => {
      const clsLower = el.cls.toLowerCase()
      let category: 'btn' | 'text' | 'input' | 'img' | 'other' = 'other'
      let shortType = 'View'
      if (clsLower.includes('edittext') || clsLower.includes('textinput')) {
        category = 'input'
        shortType = 'Input'
      } else if (clsLower.includes('button') || el.clickable) {
        category = 'btn'
        shortType = 'Button'
      } else if (clsLower.includes('image') || clsLower.includes('icon')) {
        category = 'img'
        shortType = 'Image'
      } else if (clsLower.includes('text') || el.text) {
        category = 'text'
        shortType = 'Text'
      } else {
        shortType = el.cls.split('.').pop() || 'View'
      }

      const title = el.text?.trim() || el.desc?.trim() || el.id?.split('/').pop() || shortType
      const fullTitle = `${el.text || ''} ${el.desc || ''} ${el.id || ''} ${el.cls}`.trim()
      return { el, originalIndex, category, shortType, title, fullTitle }
    })
  }, [dump])

  const filteredEls = useMemo(() => {
    return parsedEls.filter((item) => {
      if (elFilter !== 'all' && item.category !== elFilter) return false
      if (elSearch.trim()) {
        const q = elSearch.toLowerCase()
        if (!item.fullTitle.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [parsedEls, elFilter, elSearch])

  const refreshDump = async (): Promise<void> => {
    const d = await run('Đang quét danh sách phần tử trên màn hình…', dumpNow)
    if (d) {
      live.current = { d, token: actions.current, at: Date.now() }
      setDump(d)
    }
  }

  const isMismatch = useMemo(() => {
    if (!screen || !deviceDp) return false
    return Math.abs(deviceDp.w - screen.w) > 2 || Math.abs(deviceDp.h - screen.h) > 2
  }, [screen, deviceDp])

  const applyFit = async (wDp: number, hDp: number): Promise<void> => {
    try {
      const res = await window.api.figma.fitScreen(serial, wDp, hDp)
      setIsFitted(true)
      setDeviceDp({ w: wDp, h: hDp })
      setFitNote(res.message)
      live.current = null
      setTimeout(() => setFitNote(null), 4000)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const resetFit = async (): Promise<void> => {
    try {
      const res = await window.api.figma.resetScreen(serial)
      setIsFitted(false)
      setFitNote(res.message)
      live.current = null
      if (density.current) {
        const r = await window.api.automation.dumpUi(serial).catch(() => null)
        if (r) {
          setDeviceDp({
            w: Math.round((r.width * 160) / density.current),
            h: Math.round((r.height * 160) / density.current)
          })
        }
      }
      setTimeout(() => setFitNote(null), 4000)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    return () => {
      if (isFitted) {
        void window.api.figma.resetScreen(serial)
      }
    }
  }, [isFitted, serial])

  useEffect(() => {
    void window.api.figma.hasToken().then(setHasToken)
    return () => autoStore.set({ inspecting: false, highlight: null })
  }, [])

  useEffect(() => {
    density.current = 0
    live.current = null
    setDump(null)
    setAppSel(-1)
    void window.api.figma.density(serial).then(async (dens) => {
      density.current = dens
      try {
        const r = await window.api.automation.dumpUi(serial)
        setDeviceDp({
          w: Math.round((r.width * 160) / dens),
          h: Math.round((r.height * 160) / dens)
        })
      } catch {
        /* ignore */
      }
    })
  }, [serial])

  /* ------------------------------------------------------------ loading */

  const run = async <T,>(label: string, f: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label)
    setError(null)
    try {
      return await f()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const loadNode = async (fileKey: string, nodeId: string, refresh = false): Promise<void> => {
    const p = await run(refresh ? 'Đang tải lại từ Figma (trang lớn có thể mất ~1 phút)…' : 'Đang tải trang Figma (lần đầu có thể mất ~1 phút)…', () =>
      window.api.figma.load(fileKey, nodeId, refresh)
    )
    if (!p) return
    setPage(p)
    setSuggest([])
    setScreenId((cur) => (p.screens.some((s) => s.id === cur) ? cur : (p.screens[0]?.id ?? '')))
  }

  const open = async (): Promise<void> => {
    const ref = parseFigmaUrl(url)
    if (!ref) return setError('Link không đúng dạng figma.com/design/…')
    localStorage.setItem(LS_URL, url)
    void window.api.figma
      .pages(ref.fileKey)
      .then((r) => setPages(r.pages))
      .catch(() => setPages([]))
    if (ref.nodeId) await loadNode(ref.fileKey, ref.nodeId)
    else {
      setPage(null)
      setError('Link không có node-id: chọn một trang ở ô bên dưới')
    }
  }

  // Frame image (cached on disk by the main process).
  useEffect(() => {
    setImg(null)
    setFigSel(null)
    if (!page || !screenId) return
    let alive = true
    let objectUrl: string | null = null
    window.api.figma
      .image(page.fileKey, screenId)
      .then((png) => {
        if (!alive) return
        objectUrl = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
        setImg(objectUrl)
      })
      .catch((e: Error) => alive && setError(`Không tải được ảnh frame: ${e.message}`))
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [page, screenId])

  /* ------------------------------------------------------------ paste helpers */

  const handleImageLoaded = (dataUrl: string) => {
    const i = new Image()
    i.onload = () => {
      const rawW = i.naturalWidth
      const rawH = i.naturalHeight
      const autoScale = rawW > 900 ? 3 : rawW > 500 ? 2 : 1
      setPasted({ url: dataUrl, rawW, rawH, scale: autoScale })
      setTab('paste')
      setError(null)
    }
    i.src = dataUrl
  }

  const handlePasteClipboard = async (): Promise<void> => {
    try {
      const dataUrl = await window.api.figma.clipboardReadImage()
      if (dataUrl) {
        handleImageLoaded(dataUrl)
        return
      }
    } catch {
      /* fallback to web clipboard */
    }
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') handleImageLoaded(reader.result)
          }
          reader.readAsDataURL(blob)
          return
        }
      }
      setError('Clipboard chưa có ảnh — hãy copy ảnh frame trên Figma (Ctrl + Shift + C) rồi bấm lại.')
    } catch {
      setError('Không đọc được ảnh từ clipboard. Hãy copy ảnh từ Figma (Ctrl + Shift + C) hoặc chọn file.')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') handleImageLoaded(reader.result)
    }
    reader.readAsDataURL(file)
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile()
          if (file) {
            const reader = new FileReader()
            reader.onload = () => {
              if (typeof reader.result === 'string') handleImageLoaded(reader.result)
            }
            reader.readAsDataURL(file)
            e.preventDefault()
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  /* ------------------------------------------------------------ device */

  const dumpNow = async (): Promise<Dump> => {
    if (!density.current) density.current = await window.api.figma.density(serial)
    const r = await window.api.automation.dumpUi(serial)
    return toAppEls(r.nodes, r.width, r.height, density.current)
  }

  // Latest UI dump of the phone, refreshed whenever something was sent to it.
  const live = useRef<{ d: Dump; token: number; at: number } | null>(null)
  const actions = useRef(0)
  const liveTimer = useRef(0)
  const reading = useRef(false)
  const pageRef = useRef(page)
  pageRef.current = page
  const screenIdRef = useRef(screenId)
  screenIdRef.current = screenId
  const followRef = useRef(follow)
  followRef.current = follow

  /** Show the frame that matches the phone, unless the current one is about as good. */
  const autoFrame = (d: Dump): void => {
    const p = pageRef.current
    if (!p) return
    const s = suggestScreens(d.els, p.screens)
    setSuggest(s)
    if (!s.length || s[0].score < 0.2) return
    const cur = s.find((r) => p.screens[r.idx].id === screenIdRef.current)
    if (!cur || cur.score < s[0].score * 0.75) setScreenId(p.screens[s[0].idx].id)
  }

  const storeLive = (d: Dump, token: number): void => {
    const changed = !live.current || screenKey(live.current.d) !== screenKey(d)
    live.current = { d, token, at: Date.now() }
    setLiveState('ready')
    setDeviceDp({ w: d.w, h: d.h })
    if (changed) {
      autoStore.set({ highlight: null })
      autoFrame(d)
    }
  }

  const refreshLive = (delay: number): void => {
    clearTimeout(liveTimer.current)
    setLiveState('reading')
    liveTimer.current = window.setTimeout(async () => {
      const token = actions.current
      reading.current = true
      let d: Dump | null = null
      try {
        d = await dumpNow()
      } catch {
        /* secure screen, animation… */
      }
      reading.current = false
      if (!followRef.current || token !== actions.current) return // a newer input reads again
      if (d) storeLive(d, token)
      else setLiveState('failed')
    }, delay)
  }

  // Alt + click, scroll, keys, nav buttons: the screen may change.
  useEffect(
    () =>
      onAction(() => {
        actions.current++
        if (followRef.current) refreshLive(900)
      }),
    [serial] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Start / stop following; while following, notice screens the app changes by itself.
  useEffect(() => {
    if (!follow) {
      clearTimeout(liveTimer.current)
      return
    }
    refreshLive(0)
    const t = window.setInterval(() => {
      if (!reading.current && live.current && Date.now() - live.current.at > LIVE_MAX_AGE - 1000) refreshLive(0)
    }, 2000)
    return () => {
      clearInterval(t)
      clearTimeout(liveTimer.current)
    }
  }, [follow, serial]) // eslint-disable-line react-hooks/exhaustive-deps

  // Click on the phone while following: pick, don't touch.
  useEffect(
    () =>
      onInspect(async (x, y) => {
        let l = live.current
        if (!l || l.token !== actions.current || Date.now() - l.at > LIVE_MAX_AGE) {
          const token = actions.current
          const d = await run('Đang đọc màn hình điện thoại…', dumpNow)
          if (!d) return
          storeLive(d, token)
          l = live.current!
        }
        const i = appAt(l.d.els, x * l.d.w, y * l.d.h)
        setDump(l.d)
        setAppSel(i)
        setFigSel(null)
        setPulse((p) => p + 1)
        autoStore.set({ highlight: i >= 0 ? norm(l.d, l.d.els[i]) : null })
      }),
    [serial] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const toggleFollow = (): void => {
    live.current = null
    autoStore.set({ inspecting: !follow, recording: false, highlight: null })
  }

  const guessScreen = async (): Promise<void> => {
    if (!page) return
    const d = await run('Đang đọc màn hình điện thoại…', dumpNow)
    if (!d) return
    const s = suggestScreens(d.els, page.screens)
    setSuggest(s)
    if (s.length) setScreenId(page.screens[s[0].idx].id)
    else setError('Không frame nào có chữ giống màn hình hiện tại — chọn tay ở danh sách')
  }

  /* ------------------------------------------------------------ measuring */

  const autoMatch = useMemo(
    () => (dump && screen && appSel >= 0 ? matchFigma(dump.els, dump.w, dump.h, appSel, screen) : null),
    [dump, screen, appSel]
  )
  const match = figSel ?? autoMatch

  const { appM, figM } = useMemo((): { appM: Measure | null; figM: Measure | null } => {
    if (dump && appSel >= 0 && screen && match) {
      const p = measurePair(dump.els, dump.w, dump.h, appSel, screen, match.idx)
      return { appM: p.app, figM: p.fig }
    }
    return {
      appM: dump && appSel >= 0 ? measureApp(dump.els, dump.w, dump.h, appSel) : null,
      figM: screen && match ? measureFigma(screen, match.idx) : null
    }
  }, [dump, appSel, screen, match])
  const isText = !!(screen && match && screen.nodes[match.idx].type === 'TEXT')

  const [measureBox, setMeasureBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const handleFrameMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!screen) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * screen.w
    const y = ((e.clientY - r.top) / r.height) * screen.h
    dragStart.current = { x, y, moved: false }
  }

  const handleFrameMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!screen || !dragStart.current) return
    const r = e.currentTarget.getBoundingClientRect()
    const curX = Math.max(0, Math.min(screen.w, ((e.clientX - r.left) / r.width) * screen.w))
    const curY = Math.max(0, Math.min(screen.h, ((e.clientY - r.top) / r.height) * screen.h))
    const dx = Math.abs(curX - dragStart.current.x)
    const dy = Math.abs(curY - dragStart.current.y)
    if (dx > 4 || dy > 4) {
      dragStart.current.moved = true
      setMeasureBox({
        x: Math.round(Math.min(dragStart.current.x, curX)),
        y: Math.round(Math.min(dragStart.current.y, curY)),
        w: Math.round(dx),
        h: Math.round(dy)
      })
    }
  }

  const handleFrameMouseUp = async (e: React.MouseEvent<HTMLDivElement>): Promise<void> => {
    if (!screen) return
    const wasDrag = dragStart.current?.moved
    dragStart.current = null
    if (wasDrag) return

    // It was a simple click: clear measure box and pick element
    setMeasureBox(null)
    const r = e.currentTarget.getBoundingClientRect()
    const clickX = ((e.clientX - r.left) / r.width) * screen.w
    const clickY = ((e.clientY - r.top) / r.height) * screen.h

    if (tab === 'url') {
      const i = figmaAt(screen, clickX, clickY)
      setFigSel(i >= 0 ? { idx: i, how: 'chọn tay' } : null)
      setPulse((p) => p + 1)
    } else {
      let l = live.current
      if (!l || !dump) {
        const d = await run('Đang đọc màn hình điện thoại…', dumpNow)
        if (d) {
          l = { d, token: actions.current, at: Date.now() }
          live.current = l
          setDump(d)
        }
      }
      if (l) {
        const i = appAt(l.d.els, clickX, clickY)
        setDump(l.d)
        setAppSel(i)
        setPulse((p) => p + 1)
        if (i >= 0) {
          autoStore.set({ highlight: norm(l.d, l.d.els[i]) })
        }
      }
    }
  }

  /* ------------------------------------------------------------ layout */

  // The frame column: as tall as the panel by default, resizable with the splitter.
  const bodyRef = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState({ w: 0, h: 0 })
  const [viewW, setViewW] = useState<number | null>(() => Number(localStorage.getItem(LS_VIEW_W)) || null)
  const viewW0 = useRef(0)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBody({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [page, tab, pasted])
  const ratio = screen ? screen.w / screen.h : 393 / 852
  const maxViewW = Math.max(200, body.w - 280)
  const effViewW = Math.round(Math.max(200, Math.min(maxViewW, viewW ?? (body.h - 2 * PAD) * ratio + 2 * PAD)))
  const frameW = Math.max(0, Math.min(effViewW - 2 * PAD, (body.h - 2 * PAD) * ratio))
  const frameH = frameW / ratio

  /* ------------------------------------------------------------ view */

  const grouped = useMemo(() => {
    const m = new Map<string, FScreen[]>()
    const f = filter.trim().toLowerCase()
    for (const s of page?.screens ?? []) {
      if (f && !`${s.section} ${s.name}`.toLowerCase().includes(f)) continue
      const k = s.section || '(không có section)'
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return [...m]
  }, [page, filter])

  const rows = appM || figM ? compareRows(appM, figM, tol, isText) : []
  const bad = rows.filter((r) => r.cls === 'bad').length
  const checked = rows.filter((r) => r.cls).length

  return (
    <div className="panel wide fg-panel">
      {/* tabs */}
      <div className="fg-tabs">
        <button
          className={`fg-tab-btn ${tab === 'url' ? 'active' : ''}`}
          onClick={() => { setTab('url'); setError(null); }}
        >
          <Link2 size={13} /> Link Figma API
        </button>
        <button
          className={`fg-tab-btn ${tab === 'paste' ? 'active' : ''}`}
          onClick={() => { setTab('paste'); setError(null); }}
        >
          <ClipboardPaste size={13} /> Dán ảnh màn hình <span className="fg-tab-badge">Không giới hạn</span>
        </button>
      </div>

      {/* tab: url */}
      {tab === 'url' && (
        <>
          {hasToken === false ? (
            <div className="fg-setup">
              <KeyRound size={28} className="muted-ic" />
              <b>Cần Figma Personal Access Token</b>
              <ol>
                <li>Figma → ảnh đại diện → <b>Settings</b> → <b>Security</b></li>
                <li><b>Personal access tokens</b> → Generate new token, quyền <code>File content: Read-only</code></li>
                <li>Dán token vào đây. Token được mã hóa và chỉ lưu trên máy này.</li>
              </ol>
              <div className="row">
                <input className="input mono" type="password" placeholder="figd_…" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
                <button
                  className="iconbtn primary"
                  disabled={!tokenInput.trim()}
                  onClick={async () => {
                    await window.api.figma.setToken(tokenInput)
                    setTokenInput('')
                    setHasToken(true)
                  }}
                >
                  Lưu
                </button>
                {page && <button className="iconbtn" onClick={() => setHasToken(true)}>Hủy</button>}
              </div>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                💡 Hoặc bấm sang tab <b>"Dán ảnh màn hình"</b> ở trên để so sánh ngay lập tức bằng ảnh chụp mà không cần Token.
              </p>
            </div>
          ) : (
            <>
              {/* source */}
              <div className="panel-head fg-head">
                <div className="fg-url">
                  <Link2 size={13} />
                  <input
                    className="mono"
                    placeholder="Dán link Figma (figma.com/design/…?node-id=…) rồi Enter"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void open()}
                    spellCheck={false}
                  />
                </div>
                <button className="iconbtn" disabled={!!busy || !url.trim()} onClick={() => void open()}>Mở</button>
                <button
                  className="iconbtn"
                  title="Tải lại từ Figma (khi thiết kế vừa được sửa)"
                  disabled={!!busy || !page}
                  onClick={() => page && void loadNode(page.fileKey, page.nodeId, true)}
                >
                  <RefreshCw size={13} />
                </button>
                <button className="iconbtn ghost" title="Đổi Figma token" onClick={() => setHasToken(false)}><KeyRound size={13} /></button>
              </div>

              {/* frame picking + follow */}
              {(page || pages.length > 0) && (
                <div className="fg-bar">
                  {pages.length > 0 && (
                    <select
                      className="input sm fg-page"
                      value={page?.nodeId ?? ''}
                      onChange={(e) => {
                        const k = parseFigmaUrl(url)?.fileKey ?? page?.fileKey
                        if (k && e.target.value) void loadNode(k, e.target.value)
                      }}
                      title="Trang trong file Figma"
                    >
                      {!page && <option value="">— chọn trang —</option>}
                      {pages.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                  {page && (
                    <>
                      <ChevronRight size={13} className="muted-ic" />
                      <input className="input sm fg-filter" placeholder="Lọc màn…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                      <select className="input sm fg-frame-sel" value={screenId} onChange={(e) => setScreenId(e.target.value)} title="Frame (màn hình) trong thiết kế">
                        {grouped.map(([sec, list]) => (
                          <optgroup key={sec} label={sec}>
                            {list.map((s) => (
                              <option key={s.id} value={s.id}>{s.name} · {s.id}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <button className="iconbtn" disabled={!!busy} onClick={() => void guessScreen()} title="Đọc chữ trên màn hình điện thoại và chọn frame giống nhất">
                        <ScanSearch size={13} /> Tìm màn giống
                      </button>
                      {screen && isMismatch && deviceDp && (
                        <button
                          className="iconbtn primary"
                          disabled={!!busy}
                          onClick={() => void applyFit(screen.w, screen.h)}
                          title={`Điện thoại đang là ${deviceDp.w}×${deviceDp.h} dp, lệch so với Figma ${screen.w}×${screen.h} dp. Bấm để ép điện thoại co về đúng cỡ Figma.`}
                        >
                          <Smartphone size={13} /> Khớp cỡ máy ({deviceDp.w}×{deviceDp.h} → {screen.w}×{screen.h} dp)
                        </button>
                      )}
                      {isFitted && (
                        <button
                          className="iconbtn ghost warn"
                          disabled={!!busy}
                          onClick={() => void resetFit()}
                          title="Khôi phục kích thước màn hình máy về ban đầu"
                        >
                          <RotateCcw size={12} /> Khôi phục cỡ gốc
                        </button>
                      )}
                      <span className="spacer" />
                      <button
                        className={`iconbtn fg-follow ${follow ? 'on' : ''}`}
                        onClick={toggleFollow}
                        title="Bấm lên điện thoại để đo phần tử (không bấm vào app). Alt + bấm để thao tác thật. Figma tự đổi frame theo màn hình."
                      >
                        <LocateFixed size={13} /> Theo dõi
                        {follow && <span className={`fg-dot ${liveState}`} />}
                      </button>
                      <label className="fg-tol" title="Lệch quá mức này thì tô đỏ">
                        ±
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={tol}
                          onChange={(e) => {
                            setTol(Number(e.target.value))
                            localStorage.setItem(LS_TOL, e.target.value)
                          }}
                        />
                        dp
                      </label>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* tab: paste */}
      {tab === 'paste' && (
        <>
          {pasted && (
            <div className="fg-bar">
              <span className="fg-pasted-meta">
                <ImageIcon size={13} className="muted-ic" />
                <span>{pasted.rawW}×{pasted.rawH} px</span>
              </span>
              <span className="muted" style={{ fontSize: 11.5, marginLeft: 6 }}>Tỷ lệ:</span>
              <div className="fg-seg">
                {[1, 2, 3].map((s) => (
                  <button
                    key={s}
                    className={`fg-seg-btn ${pasted.scale === s ? 'on' : ''}`}
                    onClick={() => setPasted((prev) => prev ? { ...prev, scale: s } : null)}
                    title={`Chia ${s}x để tính kích thước dp`}
                  >
                    @{s}x
                  </button>
                ))}
              </div>
              <span className="fg-pasted-meta" style={{ fontWeight: 600 }}>
                = {screen?.w}×{screen?.h} dp
              </span>

              {screen && isMismatch && deviceDp && (
                <button
                  className="iconbtn primary"
                  disabled={!!busy}
                  onClick={() => void applyFit(screen.w, screen.h)}
                  title={`Điện thoại đang là ${deviceDp.w}×${deviceDp.h} dp, lệch so với thiết kế ${screen.w}×${screen.h} dp. Bấm để ép điện thoại co về đúng cỡ thiết kế.`}
                >
                  <Smartphone size={13} /> Khớp cỡ máy ({deviceDp.w}×{deviceDp.h} → {screen.w}×{screen.h} dp)
                </button>
              )}
              {isFitted && (
                <button
                  className="iconbtn ghost warn"
                  disabled={!!busy}
                  onClick={() => void resetFit()}
                  title="Khôi phục kích thước màn hình máy về ban đầu"
                >
                  <RotateCcw size={12} /> Khôi phục cỡ gốc
                </button>
              )}

              <span className="spacer" />

              <button
                className={`iconbtn fg-follow ${follow ? 'on' : ''}`}
                onClick={toggleFollow}
                title="Bấm lên điện thoại để đo phần tử. ADB Kit sẽ đánh dấu vị trí tương ứng trên ảnh thiết kế."
              >
                <LocateFixed size={13} /> Theo dõi
                {follow && <span className={`fg-dot ${liveState}`} />}
              </button>

              <button
                className="iconbtn"
                onClick={() => void handlePasteClipboard()}
                title="Dán đè ảnh mới từ Clipboard (Ctrl + V)"
              >
                <ClipboardPaste size={13} /> Dán mới
              </button>

              <button
                className="iconbtn ghost"
                onClick={() => { setPasted(null); setError(null); }}
                title="Đổi ảnh khác"
              >
                <Trash2 size={13} />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </div>
          )}

          {!pasted && (
            <div
              className={`fg-dropzone ${isDragOver ? 'dragover' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragOver(false)
                const f = e.dataTransfer.files[0]
                if (f && f.type.startsWith('image/')) {
                  const r = new FileReader()
                  r.onload = () => { if (typeof r.result === 'string') handleImageLoaded(r.result) }
                  r.readAsDataURL(f)
                }
              }}
              onClick={() => void handlePasteClipboard()}
            >
              <ImageIcon size={44} className="muted" />
              <h3>Dán ảnh màn hình thiết kế để so sánh ngay</h3>
              <p>
                1. Trên Figma: Bấm chọn Frame cần so → Nhấn <b>Ctrl + Shift + C</b> (Copy as PNG).<br />
                2. Tại đây: Bấm <b>Ctrl + V</b> ở bất kỳ đâu trên cửa sổ hoặc bấm nút bên dưới.
              </p>
              <div className="fg-drop-btn-row" onClick={(e) => e.stopPropagation()}>
                <button className="iconbtn primary" onClick={() => void handlePasteClipboard()}>
                  <ClipboardPaste size={14} /> Dán từ Clipboard (Ctrl + V)
                </button>
                <button className="iconbtn" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} /> Chọn file ảnh từ máy…
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
              </div>
            </div>
          )}
        </>
      )}

      {follow && (
        <div className="fg-hint">
          <MousePointerClick size={13} />
          <span>
            Bấm lên điện thoại để đo · <kbd>Alt</kbd> + bấm để thao tác thật · cuộn chuột, phím vẫn gửi vào máy
          </span>
          <span className="spacer" />
          <span className={`fg-live ${liveState}`}>
            {liveState === 'reading' ? (
              <>
                <Loader2 size={11} className="spin" /> đang đọc màn hình
              </>
            ) : liveState === 'ready' ? (
              'sẵn sàng'
            ) : (
              'không đọc được màn hình'
            )}
          </span>
        </div>
      )}

      {fitNote && <div className="ck-note" style={{ margin: '4px 10px' }}>{fitNote}</div>}

      {suggest.length > 0 && page && (
        <div className="fg-suggest">
          <span className="muted">Giống nhất</span>
          {suggest.map((s) => {
            const sc = page.screens[s.idx]
            return (
              <button key={sc.id} className={`fg-chip ${sc.id === screenId ? 'on' : ''}`} onClick={() => setScreenId(sc.id)} title={`${sc.section} · ${sc.id}`}>
                {sc.name} <b>{Math.round(s.score * 100)}%</b>
              </button>
            )
          })}
        </div>
      )}

      {(busy || error) && (
        <div className={`fg-msg ${error ? 'err' : ''}`}>
          {busy ? (
            <>
              <Loader2 size={12} className="spin" /> {busy}
            </>
          ) : (
            <>
              <span>{error}</span>
              {error?.includes('429') && (
                <button
                  className="iconbtn primary sm"
                  style={{ marginLeft: 10, padding: '2px 8px', height: 22, fontSize: 11 }}
                  onClick={() => { setTab('paste'); setError(null); }}
                >
                  <ClipboardPaste size={12} /> Chuyển sang Dán ảnh để dùng ngay
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'url' && !page ? (
        <div className="fg-empty">
          <ol>
            <li>Dán link Figma của trang / màn hình cần so rồi bấm <b>Mở</b>.</li>
            <li>Bật <b>Theo dõi</b>: Figma tự chọn frame giống màn hình điện thoại.</li>
            <li>Bấm vào phần tử trên điện thoại để xem kích thước, khoảng cách so với thiết kế.</li>
          </ol>
        </div>
      ) : tab === 'paste' && !pasted ? null : (
        <div className="fg-body" ref={bodyRef}>
          <div className="fg-view" style={{ width: effViewW }}>
            {screen && frameW > 0 && (
              <div
                className="fg-frame"
                style={{ width: frameW, height: frameH, cursor: 'crosshair', userSelect: 'none' }}
                onMouseDown={handleFrameMouseDown}
                onMouseMove={handleFrameMouseMove}
                onMouseUp={handleFrameMouseUp}
                title="Bấm để chọn phần tử tương ứng, hoặc kéo chuột để đo kích thước bất kỳ"
              >
                {effImg ? <img src={effImg} alt={screen.name} draggable={false} /> : <div className="fg-loading"><Loader2 size={18} className="spin" /></div>}
                {tab === 'url' && figM && match && (
                  <>
                    {figM.parent && <Outline s={screen} i={figM.parent.idx} cls="parent" />}
                    {(['top', 'bottom', 'left', 'right'] as const).map((k) => figM[k] && <Outline key={k} s={screen} i={figM[k]!.idx} cls="near" />)}
                    <Outline key={`sel-${pulse}`} s={screen} i={match.idx} cls="sel" />
                  </>
                )}
                {tab === 'paste' && dump && appSel >= 0 && (
                  <div
                    className="fg-box sel"
                    style={{
                      left: `${(dump.els[appSel].x / screen.w) * 100}%`,
                      top: `${(dump.els[appSel].y / screen.h) * 100}%`,
                      width: `${(dump.els[appSel].w / screen.w) * 100}%`,
                      height: `${(dump.els[appSel].h / screen.h) * 100}%`
                    }}
                  />
                )}
                {measureBox && (
                  <div
                    className="fg-box"
                    style={{
                      left: `${(measureBox.x / screen.w) * 100}%`,
                      top: `${(measureBox.y / screen.h) * 100}%`,
                      width: `${(measureBox.w / screen.w) * 100}%`,
                      height: `${(measureBox.h / screen.h) * 100}%`,
                      border: '2px solid #3ecf8e',
                      background: 'rgba(62, 207, 142, 0.2)',
                      pointerEvents: 'none',
                      zIndex: 10
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: measureBox.y > 24 ? -22 : 4,
                        left: 0,
                        background: '#062514',
                        border: '1px solid #3ecf8e',
                        color: '#3ecf8e',
                        fontSize: 11,
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 4,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {measureBox.w} × {measureBox.h} dp
                      {pasted ? ` (${Math.round(measureBox.w * pasted.scale)}×${Math.round(measureBox.h * pasted.scale)}px)` : ''}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Splitter
            onStart={() => (viewW0.current = effViewW)}
            onDrag={(dx) => setViewW(Math.round(Math.max(200, Math.min(maxViewW, viewW0.current + dx))))}
            onEnd={() => setViewW((w) => (localStorage.setItem(LS_VIEW_W, String(w ?? '')), w))}
            onReset={() => {
              localStorage.removeItem(LS_VIEW_W)
              setViewW(null)
            }}
          />

          <div className="fg-info">
            {/* mode switcher: chi tiết vs danh sách phần tử */}
            <div className="fg-info-mode-tabs">
              <button
                className={`fg-info-tab ${infoMode === 'detail' ? 'on' : ''}`}
                onClick={() => setInfoMode('detail')}
              >
                <Sliders size={12} /> Chi tiết & So sánh {appSel >= 0 ? `(#${appSel + 1})` : ''}
              </button>
              <button
                className={`fg-info-tab ${infoMode === 'list' ? 'on' : ''}`}
                onClick={() => {
                  setInfoMode('list')
                  if (!dump) void refreshDump()
                }}
              >
                <ListTree size={12} /> Danh sách phần tử {dump ? `(${dump.els.length})` : ''}
              </button>
            </div>

            {infoMode === 'list' ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="fg-item-search-bar" style={{ flex: 1, margin: 0 }}>
                    <Search size={13} className="muted" />
                    <input
                      placeholder="Tìm theo chữ, ID, loại nút..."
                      value={elSearch}
                      onChange={(e) => setElSearch(e.target.value)}
                    />
                  </div>
                  <button
                    className="iconbtn sm"
                    onClick={() => void refreshDump()}
                    title="Quét lại giao diện màn hình điện thoại"
                  >
                    <RefreshCw size={11} />
                  </button>
                </div>

                <div className="fg-item-filters">
                  {[
                    { id: 'all', label: `Tất cả (${parsedEls.length})` },
                    { id: 'btn', label: `Nút bấm (${parsedEls.filter((e) => e.category === 'btn').length})` },
                    { id: 'text', label: `Chữ (${parsedEls.filter((e) => e.category === 'text').length})` },
                    { id: 'input', label: `Ô nhập (${parsedEls.filter((e) => e.category === 'input').length})` },
                    { id: 'img', label: `Ảnh (${parsedEls.filter((e) => e.category === 'img').length})` }
                  ].map((f) => (
                    <button
                      key={f.id}
                      className={`fg-filter-chip ${elFilter === f.id ? 'on' : ''}`}
                      onClick={() => setElFilter(f.id as any)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {!dump ? (
                  <div className="fg-empty small" style={{ margin: 'auto 0' }}>
                    <p>Chưa có dữ liệu giao diện màn hình.</p>
                    <button className="iconbtn primary" onClick={() => void refreshDump()}>
                      <ScanSearch size={13} /> Quét phần tử trên điện thoại
                    </button>
                  </div>
                ) : filteredEls.length === 0 ? (
                  <div className="fg-empty small" style={{ margin: 'auto 0' }}>
                    Không có phần tử nào khớp với bộ lọc.
                  </div>
                ) : (
                  <div className="fg-item-list">
                    {filteredEls.map((item) => {
                      const isSel = appSel === item.originalIndex
                      return (
                        <div
                          key={item.originalIndex}
                          className={`fg-item-row ${isSel ? 'selected' : ''}`}
                          onClick={() => {
                            setAppSel(item.originalIndex)
                            setPulse((p) => p + 1)
                            autoStore.set({ highlight: norm(dump, dump.els[item.originalIndex]) })
                          }}
                          onDoubleClick={() => setInfoMode('detail')}
                          onMouseEnter={() => {
                            autoStore.set({ highlight: norm(dump, dump.els[item.originalIndex]) })
                          }}
                          onMouseLeave={() => {
                            autoStore.set({ highlight: appSel >= 0 ? norm(dump, dump.els[appSel]) : null })
                          }}
                        >
                          <div className="fg-item-header">
                            <span className={`fg-item-type ${item.category}`}>{item.shortType}</span>
                            <span className="fg-item-title" title={item.fullTitle}>{item.title}</span>
                            <span className="fg-item-dim">{item.el.w} × {item.el.h} dp</span>
                          </div>
                          <div className="fg-item-sub">
                            {item.el.id ? (
                              <span className="fg-item-id mono">{item.el.id.split('/').pop()}</span>
                            ) : (
                              <span>{item.el.cls.split('.').pop()}</span>
                            )}
                            <span className="fg-item-pos">x: {item.el.x}, y: {item.el.y} dp</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {appSel >= 0 && (
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="iconbtn sm primary" onClick={() => setInfoMode('detail')}>
                      👉 Xem chi tiết phần tử đang chọn
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {tab === 'paste' && pasted && (
              <>
                <div className="fg-title">
                  <b>{pastedScreen?.name}</b>
                  <span className="muted">
                    {screen?.w}×{screen?.h} dp · @{pasted.scale}x từ {pasted.rawW}×{pasted.rawH} px
                  </span>
                </div>

                <div className="fg-card">
                  <div className="fg-pair-row">
                    <span className="fg-tag app">Máy</span>
                    <span className="fg-name">
                      {deviceDp ? `${deviceDp.w}×${deviceDp.h} dp` : 'Chưa đọc được'}
                    </span>
                    <span className="muted">{density.current ? `${density.current} dpi` : ''}</span>
                  </div>
                  <div className="fg-pair-row">
                    <span className="fg-tag fig">Ảnh</span>
                    <span className="fg-name">{screen?.w}×{screen?.h} dp</span>
                    <span className="muted">@{pasted.scale}x</span>
                  </div>
                </div>

                {screen && isMismatch && deviceDp ? (
                  <div className="fg-verdict bad">
                    Lệch kích thước: máy {deviceDp.w}×{deviceDp.h} vs ảnh {screen.w}×{screen.h} dp
                  </div>
                ) : (
                  <div className="fg-verdict ok">
                    ✓ Kích thước máy và ảnh đã khớp ({screen?.w}×{screen?.h} dp)
                  </div>
                )}

                {measureBox && (
                  <div className="fg-card" style={{ borderLeft: '3px solid #3ecf8e', background: 'rgba(62, 207, 142, 0.08)' }}>
                    <b>Thước đo vừa kéo trên ảnh:</b>
                    <div className="fg-kv" style={{ marginTop: 6 }}>
                      <b>Kích thước:</b>
                      <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>
                        {measureBox.w} × {measureBox.h} dp
                        {pasted ? ` (${Math.round(measureBox.w * pasted.scale)}×${Math.round(measureBox.h * pasted.scale)} px)` : ''}
                      </span>
                      <b>Tọa độ:</b>
                      <span>x={measureBox.x} dp, y={measureBox.y} dp</span>
                    </div>
                  </div>
                )}

                {dump && appSel >= 0 ? (
                  <div className="fg-card">
                    <b>Phần tử đang chọn trên điện thoại:</b>
                    <div className="fg-kv" style={{ marginTop: 6 }}>
                      <b>Loại:</b>
                      <span>{dump.els[appSel].cls.split('.').pop() || dump.els[appSel].cls}</span>
                      <b>Mô tả:</b>
                      <span>{dump.els[appSel].desc || '—'}</span>
                      <b>Chữ:</b>
                      <span>{dump.els[appSel].text || '—'}</span>
                      <b>Vị trí:</b>
                      <span>x={dump.els[appSel].x} dp, y={dump.els[appSel].y} dp</span>
                      <b>Kích thước:</b>
                      <span>w={dump.els[appSel].w} dp, h={dump.els[appSel].h} dp</span>
                    </div>
                    <span className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                      Viền hồng trên ảnh thiết kế hiển thị vị trí tương ứng của phần tử này.
                    </span>
                  </div>
                ) : (
                  <div className="fg-empty small">
                    {follow ? (
                      <>Bấm vào một phần tử trên màn hình điện thoại để đo vị trí trên ảnh.</>
                    ) : (
                      <>Bật <b>Theo dõi</b> rồi bấm vào một phần tử trên màn hình điện thoại để định vị.</>
                    )}
                  </div>
                )}

                <div className="ck-note" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
                  💡 <b>Mẹo thao tác:</b> Bạn có thể chọn Frame bất kỳ trên Figma, nhấn <b>Ctrl + Shift + C</b> (Copy as PNG) rồi bấm <b>Ctrl + V</b> vào đây để chuyển màn hình cần so sánh tức thì.
                </div>
              </>
            )}

            {tab === 'url' && page && (
              <>
                {screen && (
                  <div className="fg-title">
                    <b>{screen.name}</b>
                    <span className="muted">
                      {screen.w}×{screen.h} · {screen.section || page.pageName}
                    </span>
                  </div>
                )}

                {appSel < 0 && !figSel ? (
                  <div className="fg-empty small">
                    {follow ? (
                      <>Bấm vào một phần tử trên màn hình điện thoại để đo.</>
                    ) : (
                      <>
                        Bật <b>Theo dõi</b> rồi bấm vào một phần tử trên màn hình điện thoại.
                      </>
                    )}
                    <br />
                    <span className="muted">Có thể bấm thẳng lên ảnh Figma để chọn tay node tương ứng.</span>
                  </div>
                ) : (
                  <>
                    <div className="fg-card">
                      <div className="fg-pair-row">
                        <span className="fg-tag app">App</span>
                        <span className="fg-name">{dump && appSel >= 0 ? appLabel(dump.els[appSel]) : <span className="muted">chưa chọn</span>}</span>
                        {dump && <span className="muted">{dump.w}×{dump.h}dp · {density.current}dpi</span>}
                      </div>
                      <div className="fg-pair-row">
                        <span className="fg-tag fig">Figma</span>
                        {screen && match ? (
                          <>
                            <span className="fg-name">{figmaLabel(screen.nodes[match.idx])}</span>
                            <span className="muted">{screen.nodes[match.idx].type.toLowerCase()} · ghép theo {match.how}</span>
                          </>
                        ) : (
                          <span className="muted">không tìm được node tương ứng — bấm lên ảnh Figma để chọn tay</span>
                        )}
                      </div>
                    </div>

                    {appM && figM && (
                      <div className={`fg-verdict ${bad ? 'bad' : 'ok'}`}>
                        {bad ? `${bad} / ${checked} thông số lệch quá ±${tol}dp` : `Khớp thiết kế (±${tol}dp)`}
                      </div>
                    )}

                    <table className="fg-table">
                      <thead>
                        <tr>
                          <th />
                          <th>App</th>
                          <th>Figma</th>
                          <th>Lệch</th>
                        </tr>
                      </thead>
                      {GROUPS.map((g) => {
                        const list = rows.filter((r) => r.group === g)
                        if (!list.length) return null
                        return (
                          <tbody key={g}>
                            <tr className="fg-group">
                              <td colSpan={4}>{g}</td>
                            </tr>
                            {list.map((r) => (
                              <tr key={r.label} className={r.cls}>
                                <td>{r.label}</td>
                                <td>{r.app ?? '—'}</td>
                                <td>{r.fig ?? '—'}</td>
                                <td>{r.delta && <span className={`fg-delta ${r.cls}`}>{r.delta}</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        )
                      })}
                    </table>

                    {appM && figM && dump && screen && <Neighbours app={appM} fig={figM} dump={dump} screen={screen} />}
                    {screen && match && <FigmaProps s={screen} i={match.idx} />}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- helpers */

/** Identity of a device screen: its set of texts (positions change while scrolling). */
const screenKey = (d: Dump): string =>
  [...new Set(d.els.map((e) => (e.text || e.desc).trim()).filter(Boolean))].sort().join('\u0001')

const norm = (d: Dump, e: AppEl): [number, number, number, number] => [e.x / d.w, e.y / d.h, (e.x + e.w) / d.w, (e.y + e.h) / d.h]

function Outline({ s, i, cls }: { s: FScreen; i: number; cls: string }) {
  const n = s.nodes[i]
  return (
    <div
      className={`fg-box ${cls}`}
      style={{ left: `${(n.x / s.w) * 100}%`, top: `${(n.y / s.h) * 100}%`, width: `${(n.w / s.w) * 100}%`, height: `${(n.h / s.h) * 100}%` }}
    />
  )
}

const GROUPS = ['Kích thước', 'Lề trong phần tử cha', 'Khoảng cách tới phần tử bên cạnh', 'Mép màn hình'] as const

interface Row {
  group: (typeof GROUPS)[number]
  label: string
  app?: string
  fig?: string
  delta: string
  cls: '' | 'ok' | 'bad' | 'info'
}

const fmt = (v: number): string => String(Math.round(v * 10) / 10)

function compareRows(a: Measure | null, f: Measure | null, tol: number, isText: boolean): Row[] {
  const rows: Row[] = []
  const add = (group: Row['group'], label: string, av: number | undefined, fv: number | undefined, note?: () => string): void => {
    if (av === undefined && fv === undefined) return
    let delta = ''
    let cls: Row['cls'] = ''
    if (av !== undefined && fv !== undefined) {
      const d = av - fv
      if (Math.abs(d) <= tol) {
        delta = '✓'
        cls = 'ok'
      } else {
        const n = note?.()
        delta = `${d > 0 ? '+' : ''}${fmt(d)}${n ? ` · ${n}` : ''}`
        cls = n ? 'info' : 'bad'
      }
    }
    rows.push({ group, label, app: av === undefined ? undefined : fmt(av), fig: fv === undefined ? undefined : fmt(fv), delta, cls })
  }
  // A width difference explained by the screen width (both edge margins match) is expected.
  const stretched =
    a && f && Math.abs(a.screenLeft - f.screenLeft) <= tol && Math.abs(a.screenRight - f.screenRight) <= tol ? () => 'giãn theo màn' : undefined
  // A text box on Android often spans the whole row while Figma hugs the words: not a bug by itself.
  add('Kích thước', 'Rộng', a?.w, f?.w, isText ? () => 'khung chữ' : stretched)
  add('Kích thước', 'Cao', a?.h, f?.h)
  add('Lề trong phần tử cha', 'Trái', a?.parent?.insets[0], f?.parent?.insets[0])
  add('Lề trong phần tử cha', 'Trên', a?.parent?.insets[1], f?.parent?.insets[1])
  add('Lề trong phần tử cha', 'Phải', a?.parent?.insets[2], f?.parent?.insets[2])
  add('Lề trong phần tử cha', 'Dưới', a?.parent?.insets[3], f?.parent?.insets[3])
  add('Khoảng cách tới phần tử bên cạnh', 'Phía trên', a?.top?.gap, f?.top?.gap)
  add('Khoảng cách tới phần tử bên cạnh', 'Phía dưới', a?.bottom?.gap, f?.bottom?.gap)
  add('Khoảng cách tới phần tử bên cạnh', 'Bên trái', a?.left?.gap, f?.left?.gap)
  add('Khoảng cách tới phần tử bên cạnh', 'Bên phải', a?.right?.gap, f?.right?.gap)
  add('Mép màn hình', 'Mép trái', a?.screenLeft, f?.screenLeft, isText ? () => 'khung chữ' : undefined)
  add('Mép màn hình', 'Mép phải', a?.screenRight, f?.screenRight, isText ? () => 'khung chữ' : undefined)
  return rows
}

function Neighbours({ app, fig, dump, screen }: { app: Measure; fig: Measure; dump: Dump; screen: FScreen }) {
  const items = (['top', 'bottom', 'left', 'right'] as const).filter((k) => app[k] || fig[k])
  const names = { top: 'Trên', bottom: 'Dưới', left: 'Trái', right: 'Phải' }
  return (
    <details className="fg-section">
      <summary>Phần tử dùng để đo</summary>
      <div className="muted">Kiểm tra hai bên có cùng là một phần tử không. Khung xanh / vàng trên ảnh Figma là phần tử cha / bên cạnh.</div>
      <div className="fg-grid">
        {(app.parent || fig.parent) && (
          <>
            <b>Cha</b>
            <span>{app.parent ? appLabel(dump.els[app.parent.idx]) : '—'}</span>
            <span>{fig.parent ? figmaLabel(screen.nodes[fig.parent.idx]) : '—'}</span>
          </>
        )}
        {items.map((k) => (
          <FragmentRow key={k} label={names[k]} a={app[k] ? appLabel(dump.els[app[k]!.idx]) : '—'} f={fig[k] ? figmaLabel(screen.nodes[fig[k]!.idx]) : '—'} />
        ))}
      </div>
    </details>
  )
}

function FragmentRow({ label, a, f }: { label: string; a: string; f: string }) {
  return (
    <>
      <b>{label}</b>
      <span>{a}</span>
      <span>{f}</span>
    </>
  )
}

function FigmaProps({ s, i }: { s: FScreen; i: number }) {
  const n = s.nodes[i]
  const p = n.parent >= 0 ? s.nodes[n.parent] : null
  const kv: [string, string][] = []
  kv.push(['Layer', n.name])
  if (n.fontSize) kv.push(['Chữ', `${n.fontSize}px${n.fontWeight ? ` · đậm ${n.fontWeight}` : ''}${n.lineHeight ? ` · dòng ${n.lineHeight}` : ''}`])
  if (n.fill) kv.push([n.type === 'TEXT' ? 'Màu chữ' : 'Màu nền', n.fill])
  if (n.radius) kv.push(['Bo góc', `${n.radius}`])
  if (n.layout) kv.push(['Auto layout', `${n.layout.dir === 'H' ? 'ngang' : 'dọc'} · gap ${n.layout.gap} · padding ${n.layout.pad.join('/')}`])
  if (n.sizeH || n.sizeV) kv.push(['Co giãn', `ngang ${n.sizeH ?? '—'} · dọc ${n.sizeV ?? '—'}`])
  if (p?.layout) kv.push(['Cha', `${p.name} · ${p.layout.dir === 'H' ? 'ngang' : 'dọc'} · gap ${p.layout.gap} · padding ${p.layout.pad.join('/')}`])
  return (
    <details className="fg-section" open>
      <summary>Thông số thiết kế (Figma)</summary>
      <div className="fg-kv">
        {kv.map(([k, v]) => (
          <FragmentKv key={k} k={k} v={v} />
        ))}
      </div>
    </details>
  )
}

function FragmentKv({ k, v }: { k: string; v: string }) {
  return (
    <>
      <b>{k}</b>
      <span>
        {k.startsWith('Màu') && <i className="fg-swatch" style={{ background: v }} />}
        {v}
      </span>
    </>
  )
}
