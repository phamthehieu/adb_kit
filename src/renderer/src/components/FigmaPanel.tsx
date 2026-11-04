import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, KeyRound, Link2, Loader2, LocateFixed, MousePointerClick, RefreshCw, ScanSearch } from 'lucide-react'
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

  const screen: FScreen | null = page?.screens.find((s) => s.id === screenId) ?? null

  useEffect(() => {
    void window.api.figma.hasToken().then(setHasToken)
    return () => autoStore.set({ inspecting: false, highlight: null })
  }, [])

  useEffect(() => {
    density.current = 0
    live.current = null
    setDump(null)
    setAppSel(-1)
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
    if (!p.screens.length) setError('Trang này không có frame nào cỡ màn hình điện thoại (rộng 320–480)')
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

  const pickOnFigma = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!screen) return
    const r = e.currentTarget.getBoundingClientRect()
    const i = figmaAt(screen, ((e.clientX - r.left) / r.width) * screen.w, ((e.clientY - r.top) / r.height) * screen.h)
    setFigSel(i >= 0 ? { idx: i, how: 'chọn tay' } : null)
    setPulse((p) => p + 1)
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
  }, [page])
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

  if (hasToken === false)
    return (
      <div className="panel wide fg-panel">
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
        </div>
      </div>
    )

  const rows = appM || figM ? compareRows(appM, figM, tol, isText) : []
  const bad = rows.filter((r) => r.cls === 'bad').length
  const checked = rows.filter((r) => r.cls).length

  return (
    <div className="panel wide fg-panel">
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
            error
          )}
        </div>
      )}

      {!page ? (
        <div className="fg-empty">
          <ol>
            <li>Dán link Figma của trang / màn hình cần so rồi bấm <b>Mở</b>.</li>
            <li>Bật <b>Theo dõi</b>: Figma tự chọn frame giống màn hình điện thoại.</li>
            <li>Bấm vào phần tử trên điện thoại để xem kích thước, khoảng cách so với thiết kế.</li>
          </ol>
        </div>
      ) : (
        <div className="fg-body" ref={bodyRef}>
          <div className="fg-view" style={{ width: effViewW }}>
            {screen && frameW > 0 && (
              <div className="fg-frame" style={{ width: frameW, height: frameH }} onClick={pickOnFigma} title="Bấm để chọn tay node Figma tương ứng">
                {img ? <img src={img} alt={screen.name} draggable={false} /> : <div className="fg-loading"><Loader2 size={18} className="spin" /></div>}
                {figM && match && (
                  <>
                    {figM.parent && <Outline s={screen} i={figM.parent.idx} cls="parent" />}
                    {(['top', 'bottom', 'left', 'right'] as const).map((k) => figM[k] && <Outline key={k} s={screen} i={figM[k]!.idx} cls="near" />)}
                    <Outline key={`sel-${pulse}`} s={screen} i={match.idx} cls="sel" />
                  </>
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
