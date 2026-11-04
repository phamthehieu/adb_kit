import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, RotateCcw, ScanEye, SlidersHorizontal, Wand2 } from 'lucide-react'
import type { ConfKey, DevConfig, IssueKind, UiIssue } from '@shared/devconf'
import { autoStore } from '../lib/automation'
import { lintUi } from '@shared/uiLint'
import { MapPicker, type LatLng } from './MapPicker'
import { PackagePicker } from './PackagePicker'

const KIND: Record<IssueKind, string> = {
  target: 'Vùng bấm nhỏ',
  label: 'Thiếu nhãn',
  overlap: 'Đè / chồng nhau',
  cut: 'Chữ bị cắt / tràn',
  contrast: 'Tương phản thấp',
  edge: 'Sát mép màn hình'
}

const FONT_SCALES = [0.85, 1, 1.15, 1.3, 1.5, 2]
const DENSITY_STEPS: { label: string; f: number }[] = [
  { label: 'Nhỏ', f: 0.85 },
  { label: 'Mặc định', f: 1 },
  { label: 'Lớn', f: 1.15 },
  { label: 'Rất lớn', f: 1.3 }
]
const ANIMS: { label: string; v: number }[] = [
  { label: 'Tắt', v: 0 },
  { label: '0.5×', v: 0.5 },
  { label: 'Bình thường', v: 1 }
]

async function screenImage(serial: string): Promise<ImageData | null> {
  try {
    const png = await window.api.screencap(serial)
    const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    return ctx.getImageData(0, 0, c.width, c.height)
  } catch {
    return null
  }
}

const LOCALES: [string, string][] = [
  ['', 'Theo máy'],
  ['vi-VN', 'Tiếng Việt'],
  ['en-US', 'English'],
  ['en-XA', 'Chữ dài giả (en-XA)'],
  ['ar-XB', 'Phải-sang-trái giả (ar-XB)']
]

/** Per-app language (Android 13+), incl. pseudo-locales that stretch text / mirror layout. */
function AppLocaleRow({ serial, sdk }: { serial: string; sdk: number }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('dataPkg') ?? localStorage.getItem('netPkg') ?? '')
  const [loc, setLoc] = useState('')
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const apply = async (): Promise<void> => {
    try {
      const now = await window.api.conf.appLocale(serial, pkg, loc)
      setNote({ text: `Đã đặt: ${now || 'theo máy'} — app tự tải lại giao diện. Giả lập en-XA / ar-XB chỉ có tác dụng nếu app bật pseudoLocalesEnabled (thường có ở bản debug).` })
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    }
  }
  if (sdk && sdk < 33) return <div className="muted ck-hint">Cần Android 13+ (máy đang là API {sdk}). Máy cũ: dùng "Bố cục phải-sang-trái" và đổi ngôn ngữ cả máy trong Cài đặt.</div>
  return (
    <div className="ck-line">
      <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="App…" style={{ width: 220 }} />
      <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>
        {LOCALES.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <button className="iconbtn" disabled={!pkg} onClick={() => void apply()}>Áp dụng</button>
      {note && <span className={`ck-note ${note.bad ? 'bad' : ''}`}>{note.text}</span>}
    </div>
  )
}

const PLACES: { name: string; lat: number; lng: number }[] = [
  { name: 'Hồ Gươm (Hà Nội)', lat: 21.0285, lng: 105.8542 },
  { name: 'Chợ Bến Thành (TP.HCM)', lat: 10.7725, lng: 106.698 },
  { name: 'Cầu Rồng (Đà Nẵng)', lat: 16.0612, lng: 108.2272 },
  { name: 'Sân bay Nội Bài', lat: 21.2187, lng: 105.8042 },
  { name: 'Sân bay Tân Sơn Nhất', lat: 10.8185, lng: 106.6588 }
]

/** "Vị trí GPS giả lập": pick on a map — one point, or a straight trip A → B (Android 12+). */
function GpsSection({ serial }: { serial: string }) {
  const saved = (k: string, d: number): number => Number(localStorage.getItem(k) ?? d) || d
  const [view, setView] = useState<LatLng>(() => [saved('gpsViewLat', 21.0285), saved('gpsViewLng', 105.8542)])
  const [zoom] = useState(() => saved('gpsZoom', 14))
  /** Where the map is looking now (search results near here come first). */
  const viewNow = useRef<LatLng>(view)
  const [mode, setMode] = useState<'point' | 'route'>('point')
  const [a, setA] = useState<LatLng | null>(() => (localStorage.getItem('gpsLat') ? [saved('gpsLat', 21.0285), saved('gpsLng', 105.8542)] : null))
  const [b, setB] = useState<LatLng | null>(null)
  const [secs, setSecs] = useState(60)
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ name: string; lat: number; lng: number }[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [coordText, setCoordText] = useState('')
  // Live position of the phone (fixed point, or interpolated along the trip).
  const [trip, setTrip] = useState<{ from: LatLng; to: LatLng; start: number; secs: number } | null>(null)
  const [here, setHere] = useState<LatLng | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    void window.api.gps.active(serial).then(setOn)
  }, [serial])
  useEffect(() => {
    if (!trip) return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [trip])
  const livePos: LatLng | null = trip
    ? (() => {
        const f = Math.min(1, (Date.now() - trip.start) / 1000 / trip.secs)
        return [trip.from[0] + (trip.to[0] - trip.from[0]) * f, trip.from[1] + (trip.to[1] - trip.from[1]) * f]
      })()
    : here

  const fmt = (p: LatLng): string => `${p[0].toFixed(6)}, ${p[1].toFixed(6)}`
  const pick = (p: LatLng): void => {
    if (mode === 'point') setA(p)
    else if (!a || b) {
      // Route: first click = A, second = B, a third starts over.
      setA(p)
      setB(null)
    } else setB(p)
    setCoordText(fmt(p))
  }
  const jump = (p: LatLng): void => {
    setView(p)
    pick(p)
  }

  const run = async (fn: () => Promise<void>, ok: string): Promise<boolean> => {
    setBusy(true)
    setNote(null)
    try {
      await fn()
      setNote({ text: ok })
      return true
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
      return false
    } finally {
      setBusy(false)
      setOn(await window.api.gps.active(serial))
    }
  }
  const apply = async (): Promise<void> => {
    if (!a) return
    localStorage.setItem('gpsLat', String(a[0]))
    localStorage.setItem('gpsLng', String(a[1]))
    if (await run(() => window.api.gps.set(serial, a[0], a[1]), `Điện thoại đang ở ${fmt(a)} (vị trí giả)`)) {
      setTrip(null)
      setHere(a)
    }
  }
  const go = async (): Promise<void> => {
    if (!a || !b) return
    if (await run(() => window.api.gps.route(serial, a, b, secs), `Đang đi từ A tới B trong ${secs} giây — chấm xanh trên bản đồ là vị trí hiện tại`)) {
      setTrip({ from: a, to: b, start: Date.now(), secs })
      setHere(b)
    }
  }
  const stop = async (): Promise<void> => {
    if (await run(() => window.api.gps.clear(serial), 'Đã tắt vị trí giả — điện thoại dùng lại GPS thật')) {
      setTrip(null)
      setHere(null)
    }
  }
  const search = async (): Promise<void> => {
    setSearching(true)
    try {
      setFound(await window.api.gps.search(q, viewNow.current))
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setSearching(false)
    }
  }
  // "21.02, 105.85" pasted from Google Maps.
  const useCoords = (): void => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(coordText)
    if (m) jump([Number(m[1]), Number(m[2])])
    else setNote({ text: 'Tọa độ dạng "vĩ độ, kinh độ", ví dụ 21.0285, 105.8542', bad: true })
  }

  return (
    <section className="mini-sec">
      <div className="mini-head">
        <MapPin size={14} />
        <b>Vị trí GPS giả lập</b>
        <span className="muted">Android 12+ · bấm trên bản đồ để chọn</span>
        <span className="spacer" />
        <div className="ck-seg">
          <button className={mode === 'point' ? 'on' : ''} onClick={() => setMode('point')}>Đặt 1 điểm</button>
          <button
            className={mode === 'route' ? 'on' : ''}
            onClick={() => {
              setMode('route')
              setB(null)
            }}
          >
            Đi từ A → B
          </button>
        </div>
        {on && (
          <button className="iconbtn" disabled={busy} onClick={() => void stop()}>
            <RotateCcw size={12} /> Tắt giả lập
          </button>
        )}
      </div>

      <div className="gps-tools">
        <div className="gps-search">
          <input
            className="input"
            placeholder="Tìm địa chỉ, ví dụ: Times City, 123 Lê Lợi Q1…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
          <button className="iconbtn" disabled={searching || q.trim().length < 2} onClick={() => void search()}>
            {searching ? <Loader2 size={12} className="spin" /> : 'Tìm'}
          </button>
          {found && (
            <div className="gps-results">
              {found.length === 0 && <div className="muted">Không tìm thấy</div>}
              {found.map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    jump([p.lat, p.lng])
                    setFound(null)
                  }}
                  title={p.name}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <input className="input mono" style={{ width: 200 }} placeholder="hoặc dán tọa độ: 21.02, 105.85" value={coordText} onChange={(e) => setCoordText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && useCoords()} />
        <button className="iconbtn" onClick={useCoords} disabled={!coordText.trim()}>Tới</button>
      </div>
      <div className="ck-line">
        {PLACES.map((p) => (
          <button key={p.name} className="fg-chip" onClick={() => jump([p.lat, p.lng])}>
            {p.name}
          </button>
        ))}
      </div>

      <MapPicker
        center={view}
        zoom={zoom}
        a={a}
        b={mode === 'route' ? b : null}
        here={livePos}
        onPick={pick}
        onView={(cc, z) => {
          viewNow.current = cc
          localStorage.setItem('gpsViewLat', String(cc[0]))
          localStorage.setItem('gpsViewLng', String(cc[1]))
          localStorage.setItem('gpsZoom', String(z))
        }}
      />

      <div className="gps-foot">
        {mode === 'point' ? (
          <>
            <span className="muted">{a ? `Điểm đã chọn: ${fmt(a)}` : 'Bấm lên bản đồ để chọn điểm'}</span>
            <span className="spacer" />
            <button className="iconbtn primary" disabled={busy || !a} onClick={() => void apply()}>
              {busy ? <Loader2 size={12} className="spin" /> : <MapPin size={12} />} Đặt vị trí ở đây
            </button>
          </>
        ) : (
          <>
            <span className="muted">
              {!a ? 'Bấm điểm xuất phát (A)' : !b ? `A: ${fmt(a)} — bấm điểm đến (B)` : `A → B ≈ ${distKm(a, b).toFixed(2)} km`}
            </span>
            <span className="spacer" />
            {a && b && (
              <span className="muted">
                trong
                <input className="input sm num" style={{ margin: '0 6px' }} type="number" min={5} max={3600} value={secs} onChange={(e) => setSecs(Math.max(5, +e.target.value || 60))} />
                giây (≈ {Math.round((distKm(a, b) / secs) * 3600)} km/h)
              </span>
            )}
            <button className="iconbtn primary" disabled={busy || !a || !b} onClick={() => void go()}>
              {busy ? <Loader2 size={12} className="spin" /> : <MapPin size={12} />} Bắt đầu đi
            </button>
          </>
        )}
      </div>
      {note && <div className={`ck-note ${note.bad ? 'bad' : ''}`}>{note.text}</div>}
      <div className="muted dt-note">
        Bản đồ và tìm địa chỉ cần internet (ảnh bản đồ từ OpenStreetMap France / Esri, tìm địa chỉ qua Photon — các dịch vụ này biết khu vực bạn đang xem / từ khóa bạn tìm).
      </div>
    </section>
  )
}

/** Great-circle distance in km. */
function distKm(p: LatLng, q: LatLng): number {
  const r = Math.PI / 180
  const dLat = (q[0] - p[0]) * r
  const dLng = (q[1] - p[1]) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * r) * Math.cos(q[0] * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export function CheckPanel({ serial }: { serial: string }) {
  const [conf, setConf] = useState<DevConfig | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [issues, setIssues] = useState<UiIssue[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanInfo, setScanInfo] = useState('')
  const [sel, setSel] = useState<number | null>(null)
  const [tab, setTab] = useState<'scan' | 'conf' | 'gps'>(() => {
    const t = localStorage.getItem('checkTab')
    return t === 'conf' || t === 'gps' ? t : 'scan'
  })
  const pickTab = (t: 'scan' | 'conf' | 'gps'): void => {
    setTab(t)
    localStorage.setItem('checkTab', t)
    autoStore.set({ highlight: null })
  }
  const [filter, setFilter] = useState<IssueKind | 'all'>('all')

  const load = useCallback(async () => {
    try {
      setConf(await window.api.conf.get(serial))
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    }
  }, [serial])
  useEffect(() => void load(), [load])
  // Never leave an outline on the phone screen after leaving the tab.
  useEffect(() => () => autoStore.set({ highlight: null }), [])

  const scan = useCallback(async () => {
    setScanning(true)
    setSel(null)
    autoStore.set({ highlight: null })
    try {
      const [dump, image, density] = await Promise.all([window.api.automation.dumpUi(serial), screenImage(serial), window.api.figma.density(serial)])
      const t = performance.now()
      const found = lintUi({ ...dump, density, image })
      setIssues(found)
      const appNodes = dump.nodes.filter((n) => !/^(com\.android\.systemui|android)$/.test(n.pkg)).length
      setScanInfo(
        !appNodes
          ? 'Màn hình đang là giao diện hệ thống (màn khóa / thanh thông báo) — mở app cần soát rồi bấm lại'
          : `${appNodes} phần tử · ${Math.round(performance.now() - t)} ms${image ? '' : ' · không chụp được ảnh (bỏ qua kiểm tra tương phản)'}`
      )
    } catch (e) {
      setIssues(null)
      setScanInfo(`Không đọc được màn hình: ${(e as Error).message}`)
    } finally {
      setScanning(false)
    }
  }, [serial])

  const set = async (key: ConfKey, value: string, label: string): Promise<void> => {
    setBusy(key)
    setNote(null)
    try {
      const r = await window.api.conf.set(serial, key, value)
      setConf(r.config)
      setNote(r.note ? { text: r.note, bad: true } : { text: `Đã đổi: ${label}` })
      // Re-check the screen once the app has re-laid out, if a check was already shown.
      if (issues) window.setTimeout(() => void scan(), 1800)
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(null)
    }
  }

  const restore = async (): Promise<void> => {
    setBusy('restore')
    try {
      const r = await window.api.conf.restore(serial)
      setConf(r.config)
      setNote({ text: r.note ?? 'Đã khôi phục cấu hình ban đầu của máy' })
      if (issues) window.setTimeout(() => void scan(), 1800)
    } finally {
      setBusy(null)
    }
  }

  /** The most common check: big font, then look for overlaps / cut text. */
  const bigFontCheck = async (): Promise<void> => {
    const hadResults = !!issues
    if (conf?.fontScale !== 1.3) await set('fontScale', '1.3', 'cỡ chữ 1.3×')
    // set() already re-checks when results are shown; otherwise check once the app re-laid out.
    if (!hadResults || conf?.fontScale === 1.3) {
      setScanning(true)
      window.setTimeout(() => void scan(), 2000)
    }
  }

  const pick = (i: number): void => {
    setSel(i)
    autoStore.set({ highlight: shown[i]?.b ?? null })
  }

  const shown = (issues ?? []).filter((x) => filter === 'all' || x.kind === filter)
  const counts = (issues ?? []).reduce<Partial<Record<IssueKind, number>>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {})
  const bad = (issues ?? []).filter((x) => x.level === 'bad').length

  const seg = <T,>(items: { label: string; value: T }[], current: T | undefined, onPick: (v: T, label: string) => void, key: string) => (
    <div className={`ck-seg ${busy === key ? 'busy' : ''}`}>
      {items.map((it) => (
        <button key={it.label} className={current === it.value ? 'on' : ''} disabled={!!busy} onClick={() => current !== it.value && onPick(it.value, it.label)}>
          {it.label}
        </button>
      ))}
    </div>
  )

  const densOpts = conf ? DENSITY_STEPS.map((d) => ({ label: d.label, value: Math.round(conf.baseDensity * d.f) })) : []

  return (
    <div className="panel wide ck-panel">
      <div className="panel-head">
        <div className="seg">
          <button className={tab === 'scan' ? 'on' : ''} onClick={() => pickTab('scan')} title="Tự tìm lỗi giao diện trên màn hình đang mở">Soát giao diện</button>
          <button className={tab === 'conf' ? 'on' : ''} onClick={() => pickTab('conf')} title="Chế độ tối, cỡ chữ, kích thước hiển thị, hiệu ứng">Cấu hình máy</button>
          <button className={tab === 'gps' ? 'on' : ''} onClick={() => pickTab('gps')} title="Giả vị trí GPS của điện thoại">Vị trí GPS</button>
        </div>
      </div>
      <div className="ck-body">
        {tab === 'conf' && (
        <section className="mini-sec">
          <div className="mini-head">
            <SlidersHorizontal size={14} />
            <b>Cấu hình máy</b>
            <span className="muted">đổi nhanh để xem app có vỡ giao diện không</span>
            <span className="spacer" />
            {conf && conf.changed.length > 0 && (
              <button className="iconbtn" disabled={!!busy} onClick={() => void restore()} title="Đưa mọi thiết lập ADB Kit đã đổi về như lúc đầu">
                {busy === 'restore' ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />} Khôi phục ({conf.changed.length})
              </button>
            )}
          </div>
          {!conf && <div className="steps-empty"><Loader2 size={14} className="spin" /> Đang đọc cấu hình…</div>}
          {conf && (
            <div className="ck-grid">
              <span>Chế độ tối</span>
              {seg([{ label: 'Sáng', value: false }, { label: 'Tối', value: true }], conf.dark, (v, l) => void set('dark', v ? 'yes' : 'no', `chế độ ${l.toLowerCase()}`), 'dark')}
              <span>Cỡ chữ</span>
              {seg(FONT_SCALES.map((f) => ({ label: `${f}×`, value: f })), conf.fontScale, (v, l) => void set('fontScale', String(v), `cỡ chữ ${l}`), 'fontScale')}
              <span>Kích thước hiển thị</span>
              <div className="ck-line">
                {seg(densOpts, conf.density, (v, l) => void set('density', String(v), `kích thước hiển thị ${l.toLowerCase()} (${v} dpi)`), 'density')}
                <span className="muted">{conf.density} dpi</span>
              </div>
              <span>Hiệu ứng chuyển động</span>
              {seg(ANIMS.map((a) => ({ label: a.label, value: a.v })), conf.animations, (v, l) => void set('animations', String(v), `hiệu ứng ${l.toLowerCase()}`), 'animations')}
              <span>Công cụ dev</span>
              <div className="ck-line">
                <label className="mini-check">
                  <input type="checkbox" checked={conf.layoutBounds} disabled={!!busy} onChange={(e) => void set('layoutBounds', String(e.target.checked), e.target.checked ? 'bật viền layout' : 'tắt viền layout')} /> Hiện viền layout
                </label>
                <label className="mini-check">
                  <input type="checkbox" checked={conf.showTouches} disabled={!!busy} onChange={(e) => void set('showTouches', e.target.checked ? '1' : '0', e.target.checked ? 'hiện điểm chạm' : 'ẩn điểm chạm')} /> Hiện điểm chạm
                </label>
                <label className="mini-check" title="Lật bố cục như tiếng Ả Rập / Do Thái — tìm chỗ căn lề cứng, icon mũi tên sai chiều">
                  <input type="checkbox" checked={conf.rtl} disabled={!!busy} onChange={(e) => void set('rtl', e.target.checked ? '1' : '0', e.target.checked ? 'bố cục phải-sang-trái' : 'bố cục trái-sang-phải')} /> Bố cục phải-sang-trái
                </label>
              </div>
              <span>Ngôn ngữ của app</span>
              <AppLocaleRow serial={serial} sdk={conf.sdk} />
            </div>
          )}
          {note && <div className={`ck-note ${note.bad ? 'bad' : ''}`}>{note.text}</div>}
          {conf && conf.changed.length > 0 && <div className="ck-note muted">Thiết lập gốc đã được ghi nhớ — nhớ bấm Khôi phục khi test xong (vẫn khôi phục được sau khi tắt ADB Kit).</div>}
        </section>
        )}

        {tab === 'gps' && <GpsSection serial={serial} />}

        {tab === 'scan' && (
        <section className="mini-sec">
          <div className="mini-head">
            <ScanEye size={14} />
            <b>Soát màn hình này</b>
            <span className="muted">{scanInfo}</span>
            <span className="spacer" />
            <button className="iconbtn" disabled={scanning || !!busy} onClick={() => void bigFontCheck()} title="Đặt cỡ chữ 1.3× rồi soát — cách nhanh nhất để thấy chữ đè, chữ bị cắt">
              <Wand2 size={12} /> Thử chữ to 1.3× + soát
            </button>
            <button className="iconbtn primary" disabled={scanning} onClick={() => void scan()}>
              {scanning ? <Loader2 size={12} className="spin" /> : <ScanEye size={12} />} Soát
            </button>
          </div>
          {!issues && !scanning && (
            <div className="steps-empty">
              Mở màn cần kiểm tra trên điện thoại rồi bấm <b>Soát</b>. App kiểm tra: vùng bấm nhỏ hơn 48dp, nút không có nhãn cho TalkBack, chữ đè nhau, chữ bị cắt hoặc tràn khung, chữ sát mép, tương phản chữ thấp.
            </div>
          )}
          {issues && (
            <>
              <div className="ck-sum">
                <button className={`fg-chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
                  {issues.length ? `Tất cả ${issues.length}` : 'Không thấy vấn đề nào'}
                  {bad > 0 && <span className="ck-bad"> · {bad} nặng</span>}
                </button>
                {(Object.keys(KIND) as IssueKind[]).filter((k) => counts[k]).map((k) => (
                  <button key={k} className={`fg-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                    {KIND[k]} {counts[k]}
                  </button>
                ))}
              </div>
              {shown.length > 0 && <div className="ck-list">
                {shown.map((x, i) => (
                  <div
                    key={i}
                    className={`ck-item ${x.level} ${sel === i ? 'sel' : ''}`}
                    onMouseEnter={() => autoStore.set({ highlight: x.b })}
                    onMouseLeave={() => autoStore.set({ highlight: sel !== null ? (shown[sel]?.b ?? null) : null })}
                    onClick={() => pick(i)}
                  >
                    <span className={`ck-dot ${x.level}`} />
                    <div>
                      <div className="t">{x.title}</div>
                      <div className="d">{x.detail}</div>
                    </div>
                  </div>
                ))}
              </div>}
              {issues.length > 0 && <div className="ck-note muted">Rê chuột / bấm vào từng mục để khoanh phần tử trên màn hình điện thoại. Đây là kiểm tra tự động theo kinh nghiệm — hãy xem lại bằng mắt trước khi báo lỗi.</div>}
            </>
          )}
        </section>
        )}
      </div>
    </div>
  )
}
