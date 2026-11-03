import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppWindow, Bug, Eraser, ExternalLink, Globe, Link, Loader2, Network, Play, Plus, RefreshCw, Timer, X } from 'lucide-react'
import type { MiniAppInfo, MiniAppList, OpenTiming, WebPage, WebViewProc } from '@shared/miniapp'
import { PackagePicker } from './PackagePicker'

interface SavedLink {
  name: string
  url: string
}

/** Known deep-link templates for opening one mini-app directly. */
const LINK_TEMPLATES: Record<string, string> = {
  'com.viettel.appviettel': 'tammi://miniapp?appId={appId}',
  'com.viettel.appviettel.staging': 'tammi://miniapp?appId={appId}'
}

const kb = (n?: number): string => (n === undefined ? '' : n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${n} KB`)

function ago(ms?: number): string {
  if (!ms) return ''
  const s = (Date.now() - ms) / 1000
  if (s < 60) return 'vừa xong'
  if (s < 3600) return `${Math.round(s / 60)} phút trước`
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`
  return `${Math.round(s / 86400)} ngày trước`
}

const fill = (tpl: string, a: MiniAppInfo): string =>
  tpl.replace(/\{appId\}/g, encodeURIComponent(a.appId)).replace(/\{miniAppId\}/g, String(a.miniAppId ?? '')).replace(/\{name\}/g, encodeURIComponent(a.name))

const shortUrl = (u: string): string => u.replace(/^https?:\/\//, '').slice(0, 90)

function loadLinks(): SavedLink[] {
  try {
    return JSON.parse(localStorage.getItem('miniLinks') ?? '[]') as SavedLink[]
  } catch {
    return []
  }
}

interface TimingRecord {
  appId: string
  name: string
  version?: string
  t: OpenTiming
}

const sec = (ms?: number): string => (ms === undefined ? '—' : `${(ms / 1000).toFixed(2)} s`)

/** Waterfall of one open: phases as bars on a common time scale, paints as markers. */
function TimingView({ t, name }: { t: OpenTiming; name: string }) {
  if (!t.ok) return <div className="bad">“{name}”: {t.error}</div>
  const end = Math.max(t.idleMs ?? 0, t.loadMs ?? 0, t.lcpMs ?? 0, 1)
  const phases: { label: string; from: number; to?: number; cls: string; hint: string }[] = [
    { label: 'Container + WebView', from: 0, to: t.webviewMs, cls: 'p0', hint: 'Từ lúc mở đến khi trang bắt đầu tải: app xử lý link, tải/giải nén gói miniapp, tạo WebView' },
    { label: 'Tải HTML', from: t.webviewMs ?? 0, to: t.htmlMs, cls: 'p1', hint: 'Nhận xong file HTML của miniapp' },
    { label: 'Dựng trang (DOM)', from: t.htmlMs ?? 0, to: t.domMs, cls: 'p2', hint: 'Chạy script, DOMContentLoaded' },
    { label: 'Tải tài nguyên (load)', from: t.domMs ?? 0, to: t.loadMs, cls: 'p3', hint: 'Ảnh, font, script còn lại — sự kiện load' },
    { label: 'Đến khi mạng yên', from: t.loadMs ?? 0, to: t.idleMs, cls: 'p4', hint: 'Request cuối cùng xong (API của trang, lazy load…). API gọi qua bridge (WVFetch) không tính ở đây.' }
  ]
  const marks = [
    { label: 'FCP', v: t.fcpMs, hint: 'Lần đầu hiện nội dung' },
    { label: 'LCP', v: t.lcpMs, hint: 'Nội dung chính hiện ra' },
    { label: 'Hiện', v: t.fcpMs ? undefined : t.shownMs, hint: 'Trang hiện lên màn hình' }
  ].filter((m) => m.v !== undefined)
  const pct = (v: number): string => `${Math.min(100, (v / end) * 100)}%`
  return (
    <div className="tm-card">
      <div className="tm-title">
        <b>{name}</b> <span className="muted">{t.cold ? 'lần đầu (đã xóa gói)' : 'đã có gói'} · tổng đến khi mạng yên {sec(t.idleMs ?? t.loadMs)}</span>
      </div>
      {phases.map((p) =>
        p.to === undefined ? null : (
          <div key={p.label} className="tm-row" title={p.hint}>
            <span className="tm-l">{p.label}</span>
            <div className="tm-track">
              <div className={`tm-bar ${p.cls}`} style={{ left: pct(p.from), width: `calc(${pct(Math.max(0, p.to - p.from))} + 2px)` }} />
              {marks.map((m) => (
                <div key={m.label} className="tm-mark" style={{ left: pct(m.v!) }} />
              ))}
            </div>
            <span className="tm-v mono">{sec(p.to)}</span>
          </div>
        )
      )}
      <div className="tm-foot">
        {marks.map((m) => (
          <span key={m.label} title={m.hint}>
            <i className="tm-dot" /> {m.label} {sec(m.v)}
          </span>
        ))}
        <span className="muted">
          {t.resources} tài nguyên · {t.transferKb} KB qua mạng
        </span>
      </div>
      {t.paintNote && <div className="muted tm-note">{t.paintNote}</div>}
      {t.slowest && t.slowest.length > 0 && (
        <div className="tm-slow">
          <span className="muted">Chậm nhất:</span>
          {t.slowest.map((s, i) => (
            <span key={i} className="mono" title={s.name}>
              {s.name.split('/').pop() || s.name} {s.ms} ms
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function MiniAppPanel({ serial, onWatchNetwork }: { serial: string; onWatchNetwork: (pkg: string) => void }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('miniPkg') ?? localStorage.getItem('netPkg') ?? '')
  const [list, setList] = useState<MiniAppList | null>(null)
  const [loading, setLoading] = useState(false)
  const [procs, setProcs] = useState<WebViewProc[]>([])
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [filter, setFilter] = useState('')
  const [tpl, setTpl] = useState('')
  const [links, setLinks] = useState<SavedLink[]>(loadLinks)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkName, setLinkName] = useState('')
  const [onlyApp, setOnlyApp] = useState(true)

  const say = (text: string, bad = false): void => setMsg({ text, bad })

  // Deep-link template remembered per super-app.
  useEffect(() => {
    if (!pkg) return
    localStorage.setItem('miniPkg', pkg)
    setTpl(localStorage.getItem(`miniLink:${pkg}`) ?? LINK_TEMPLATES[pkg] ?? '')
  }, [pkg])
  const saveTpl = (v: string): void => {
    setTpl(v)
    localStorage.setItem(`miniLink:${pkg}`, v)
  }

  const loadApps = useCallback(async () => {
    if (!pkg) return
    setLoading(true)
    try {
      setList(await window.api.mini.list(serial, pkg))
    } catch (e) {
      setList({ container: null, apps: [], note: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [serial, pkg])
  useEffect(() => void loadApps(), [loadApps])

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setProcs(await window.api.mini.webviews(serial))
    } catch (e) {
      say(`Không đọc được danh sách WebView: ${(e as Error).message}`, true)
    } finally {
      setScanning(false)
    }
  }, [serial])
  // Keep the WebView list live: pages come and go as mini-apps open and close.
  useEffect(() => {
    void scan()
    const t = setInterval(() => void scan(), 3000)
    return () => clearInterval(t)
  }, [scan])

  const shownProcs = useMemo(() => (onlyApp && pkg ? procs.filter((p) => p.pkg === pkg || p.pkg.startsWith(`${pkg}:`)) : procs), [procs, onlyApp, pkg])

  const apps = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (list?.apps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.appId.includes(q))
  }, [list, filter])

  const devtools = async (p: WebViewProc, page: WebPage): Promise<void> => {
    try {
      await window.api.mini.devtools(serial, p.socket, page)
    } catch (e) {
      say(`Không mở được DevTools: ${(e as Error).message}`, true)
    }
  }

  const open = async (url: string, restrict = true): Promise<void> => {
    if (!url.trim()) return
    say(`Đang mở ${url}…`)
    try {
      await window.api.mini.openLink(serial, url.trim(), restrict && pkg ? pkg : undefined)
      say(`Đã mở ${url}`)
    } catch (e) {
      say(`Không mở được: ${(e as Error).message}`, true)
    }
  }

  const clearCache = async (a: MiniAppInfo): Promise<void> => {
    if (!confirm(`Xóa gói đã tải của miniapp "${a.name}"?\n\nApp sẽ bị đóng lại; lần mở miniapp tiếp theo sẽ tải lại bản mới nhất từ server.`)) return
    try {
      await window.api.mini.clearCache(serial, pkg, a.appId)
      say(`Đã xóa cache "${a.name}" và đóng app`)
      void loadApps()
    } catch (e) {
      say(`Không xóa được: ${(e as Error).message}`, true)
    }
  }

  const addLink = (): void => {
    if (!linkUrl.trim()) return
    const next = [...links.filter((l) => l.url !== linkUrl.trim()), { name: linkName.trim() || linkUrl.trim(), url: linkUrl.trim() }]
    setLinks(next)
    localStorage.setItem('miniLinks', JSON.stringify(next))
    setLinkName('')
  }
  const removeLink = (url: string): void => {
    const next = links.filter((l) => l.url !== url)
    setLinks(next)
    localStorage.setItem('miniLinks', JSON.stringify(next))
  }

  // Open-time measurements, kept on this PC to compare versions / first vs. cached opens.
  const [cold, setCold] = useState(false)
  const [measuring, setMeasuring] = useState<string | null>(null)
  const [timings, setTimings] = useState<TimingRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('miniTimings') ?? '[]') as TimingRecord[]
    } catch {
      return []
    }
  })
  const [lastTiming, setLastTiming] = useState<TimingRecord | null>(null)
  const saveTimings = (list: TimingRecord[]): void => {
    setTimings(list)
    localStorage.setItem('miniTimings', JSON.stringify(list.slice(0, 100)))
  }
  const measure = async (a: MiniAppInfo, url = fill(tpl, a)): Promise<void> => {
    const isApp = !!list?.apps.some((x) => x.appId === a.appId)
    const c = cold && isApp
    if (c && !confirm(`Đo "${a.name}" như lần đầu: xóa gói đã tải và đóng app, rồi mở lại?`)) return
    setMeasuring(a.name)
    try {
      const t = await window.api.mini.measure(serial, pkg, url, isApp ? a.appId : undefined, c)
      const rec: TimingRecord = { appId: a.appId, name: a.name, version: a.version, t }
      setLastTiming(rec)
      saveTimings([rec, ...timings])
      if (c) void loadApps()
    } catch (e) {
      say(`Không đo được: ${(e as Error).message}`, true)
    } finally {
      setMeasuring(null)
    }
  }

  const pageCount = shownProcs.reduce((n, p) => n + p.pages.length, 0)

  return (
    <div className="panel wide mini-panel">
      <div className="log-tools">
        <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="Chọn super app…" style={{ width: 260 }} />
        <button className="iconbtn" disabled={!pkg} onClick={() => void loadApps()} title="Đọc lại danh sách miniapp">
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
        <button className="iconbtn" disabled={!pkg} onClick={() => onWatchNetwork(pkg)} title="Mở tab Mạng / API để xem API và lệnh bridge của miniapp theo thời gian thực">
          <Network size={13} /> Theo dõi API &amp; bridge
        </button>
        <span className="spacer" />
        {msg && <span className={`mini-msg ${msg.bad ? 'bad' : ''}`}>{msg.text}</span>}
      </div>

      <div className="mini-body">
        {/* ------------------------------------------------ WebViews */}
        <section className="mini-sec">
          <div className="mini-head">
            <Globe size={14} />
            <b>WebView đang mở</b>
            <span className="muted">{pageCount} trang</span>
            {scanning && <Loader2 size={12} className="spin muted" />}
            <span className="spacer" />
            <label className="mini-check">
              <input type="checkbox" checked={onlyApp} onChange={(e) => setOnlyApp(e.target.checked)} /> Chỉ app đã chọn
            </label>
          </div>
          {shownProcs.length === 0 && (
            <div className="steps-empty">
              {onlyApp && pkg
                ? 'App này chưa mở WebView nào có thể soi. Mở một miniapp trên máy — trang sẽ hiện ở đây sau vài giây. (App phải là bản debug, hoặc bật WebView.setWebContentsDebuggingEnabled.)'
                : 'Không thấy WebView nào có thể soi trên máy.'}
            </div>
          )}
          {shownProcs.map((p) => (
            <div key={p.socket} className="mini-proc">
              <div className="mini-proc-head">
                <AppWindow size={13} />
                <b>{p.pkg}</b>
                {p.pid > 0 && <span className="muted">pid {p.pid}</span>}
                {p.browser && <span className="muted">{p.browser.replace('Chrome/', 'WebView ')}</span>}
                {p.error && <span className="bad">{p.error}</span>}
              </div>
              {p.pages.length === 0 && !p.error && <div className="mini-page muted">(chưa có trang)</div>}
              {p.pages.map((pg) => (
                <div key={pg.id} className={`mini-page ${pg.visible ? 'on' : ''}`}>
                  <span className={`mini-dot ${pg.visible ? 'on' : ''}`} title={pg.visible ? 'Đang hiển thị trên màn hình' : 'Đang ẩn / chạy nền'} />
                  <div className="mini-page-t">
                    <div className="t">{pg.title || '(không tiêu đề)'}</div>
                    <div className="u" title={pg.url}>{shortUrl(pg.url)}</div>
                  </div>
                  <button className="iconbtn" onClick={() => void devtools(p, pg)} title="Mở Chrome DevTools cho trang này: Elements, Console, Network, Sources, Application…">
                    <Bug size={13} /> DevTools
                  </button>
                </div>
              ))}
            </div>
          ))}
        </section>

        {/* ------------------------------------------------ Mini-apps */}
        <section className="mini-sec">
          <div className="mini-head">
            <AppWindow size={14} />
            <b>Miniapp đã tải về máy</b>
            {list?.container && <span className="mini-tag">{list.container}</span>}
            <span className="muted">{list ? `${list.apps.length} miniapp` : ''}</span>
            <span className="spacer" />
            <input className="input" placeholder="Lọc tên / appId…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} />
          </div>
          <div className="mini-tpl">
            <Link size={12} />
            <span className="muted">Deep link mở miniapp</span>
            <input
              className="input"
              value={tpl}
              onChange={(e) => saveTpl(e.target.value)}
              placeholder="vd. myapp://miniapp?appId={appId}"
              title="Dùng {appId}, {miniAppId}, {name}. Để trống nếu app không hỗ trợ mở miniapp bằng link."
            />
          </div>
          {!pkg && <div className="steps-empty">Chọn super app để xem các miniapp nó đã tải.</div>}
          {list?.note && <div className="steps-empty">{list.note}</div>}
          {apps.length > 0 && (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Miniapp</th>
                  <th>Phiên bản</th>
                  <th>Dung lượng</th>
                  <th>Cập nhật</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.appId}>
                    <td>
                      <div className="mini-app">
                        {a.icon ? <img src={a.icon} alt="" referrerPolicy="no-referrer" /> : <span className="mini-noicon" />}
                        <div>
                          <div className="t">{a.name}</div>
                          <div className="u" title="appId">{a.appId}{a.type ? ` · ${a.type}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{a.version ?? '—'}</td>
                    <td className="mono">{kb(a.cacheKb) || '—'}</td>
                    <td className="muted" title={a.updatedAt ? new Date(a.updatedAt).toLocaleString() : ''}>{ago(a.updatedAt)}</td>
                    <td className="mini-act">
                      <button className="iconbtn" disabled={!tpl} onClick={() => void open(fill(tpl, a))} title={tpl ? fill(tpl, a) : 'Nhập mẫu deep link ở trên trước'}>
                        <Play size={12} /> Mở
                      </button>
                      <button
                        className="iconbtn"
                        disabled={!tpl || !!measuring}
                        onClick={() => void measure(a)}
                        title={cold ? 'Đo thời gian mở như lần đầu (xóa gói, mở lại app)' : 'Đo thời gian mở (đã có gói trên máy)'}
                      >
                        <Timer size={12} />
                      </button>
                      <button className="iconbtn ghost" onClick={() => void clearCache(a)} title="Xóa gói đã tải để app tải lại bản mới nhất">
                        <Eraser size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ------------------------------------------------ Open timing */}
        <section className="mini-sec">
          <div className="mini-head">
            <Timer size={14} />
            <b>Thời gian mở miniapp</b>
            <span className="muted">bấm ⏱ ở danh sách trên để đo</span>
            <span className="spacer" />
            <label className="mini-check" title="Xóa gói đã tải và khởi động lại app trước khi đo — như lần đầu mở sau khi cài / cập nhật">
              <input type="checkbox" checked={cold} onChange={(e) => setCold(e.target.checked)} /> Như lần đầu (xóa gói, mở lại app)
            </label>
          </div>
          {measuring && (
            <div className="steps-empty">
              <Loader2 size={13} className="spin" /> Đang đo “{measuring}”… (mở miniapp, chờ tải xong và mạng yên — tối đa ~60 giây)
            </div>
          )}
          {lastTiming && <TimingView t={lastTiming.t} name={lastTiming.name} />}
          {timings.length > 0 && (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Lúc</th>
                  <th>Miniapp</th>
                  <th>Kiểu</th>
                  <th>WebView</th>
                  <th>Hiện nội dung</th>
                  <th>Tải xong</th>
                  <th>Mạng yên</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {timings.slice(0, 20).map((h, i) => (
                  <tr key={i} onClick={() => setLastTiming(h)} style={{ cursor: 'pointer' }}>
                    <td className="muted">{new Date(h.t.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</td>
                    <td>
                      {h.name} <span className="muted">{h.version ? `v${h.version}` : ''}</span>
                    </td>
                    <td className="muted">{h.t.cold ? 'lần đầu' : 'có cache'}</td>
                    {h.t.ok ? (
                      <>
                        <td className="mono">{sec(h.t.webviewMs)}</td>
                        <td className="mono">{sec(h.t.lcpMs ?? h.t.fcpMs ?? h.t.shownMs)}</td>
                        <td className="mono">{sec(h.t.loadMs)}</td>
                        <td className="mono">{sec(h.t.idleMs)}</td>
                      </>
                    ) : (
                      <td colSpan={4} className="bad">{h.t.error}</td>
                    )}
                    <td className="mini-act">
                      <button className="iconbtn ghost" title="Xóa dòng này" onClick={(e) => { e.stopPropagation(); saveTimings(timings.filter((_, k) => k !== i)) }}>
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ------------------------------------------------ Links */}
        <section className="mini-sec">
          <div className="mini-head">
            <ExternalLink size={14} />
            <b>Mở link nhanh</b>
            <span className="muted">deep link / URL, mở thẳng màn cần test</span>
          </div>
          <div className="mini-linkrow">
            <input className="input" placeholder="Tên (tùy chọn)" value={linkName} onChange={(e) => setLinkName(e.target.value)} style={{ width: 130 }} />
            <input
              className="input grow"
              placeholder="vd. tammi://miniapp?appId=… hoặc https://…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void open(linkUrl)}
            />
            <button className="iconbtn" disabled={!linkUrl.trim()} onClick={() => void open(linkUrl)}><Play size={12} /> Mở</button>
            <button className="iconbtn" disabled={!linkUrl.trim()} onClick={addLink} title="Lưu vào danh sách"><Plus size={12} /> Lưu</button>
          </div>
          {links.map((l) => (
            <div key={l.url} className="mini-link">
              <button className="iconbtn" onClick={() => void open(l.url)} title={`Mở trong ${pkg || 'app mặc định'}`}><Play size={12} /></button>
              <button
                className="iconbtn"
                disabled={!pkg || !!measuring}
                onClick={() => void measure({ appId: l.url, name: l.name }, l.url)}
                title="Đo thời gian mở link này (trang WebView của app đã chọn)"
              >
                <Timer size={12} />
              </button>
              <div className="mini-page-t" onClick={() => { setLinkUrl(l.url); setLinkName(l.name) }} title="Bấm để sửa">
                <div className="t">{l.name}</div>
                {l.name !== l.url && <div className="u">{l.url}</div>}
              </div>
              <button className="iconbtn ghost" onClick={() => removeLink(l.url)}><X size={12} /></button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
