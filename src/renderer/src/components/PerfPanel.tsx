import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Flag, Gauge, Loader2, Play, Square, Trash2 } from 'lucide-react'
import { liveRemarks, type LiveMark, type LiveSample } from '@shared/perflive'
import { PackagePicker } from './PackagePicker'
import { tell } from '../lib/dialog'

const MAX_SAMPLES = 7200
const VIEWS = [
  { id: 60, label: '1 phút gần nhất' },
  { id: 300, label: '5 phút gần nhất' },
  { id: 0, label: 'Toàn bộ' }
] as const

interface Series {
  key: 'memMb' | 'cpu' | 'fps' | 'tempC'
  title: string
  unit: string
  color: string
  hint: string
  /** Fixed top of the scale (otherwise it follows the data). */
  floor?: number
  digits?: number
}
const SERIES: Series[] = [
  { key: 'memMb', title: 'Bộ nhớ (RAM)', unit: 'MB', color: '#4cc2ff', hint: 'Tăng đều khi lặp một thao tác = nghi rò rỉ bộ nhớ.', floor: 50 },
  { key: 'cpu', title: 'CPU của app', unit: '%', color: '#f5b84c', hint: '100% = dùng hết một lõi. Cao liên tục khi không thao tác = có việc chạy ngầm.', floor: 100 },
  { key: 'fps', title: 'Khung hình / giây', unit: 'fps', color: '#39d98a', hint: 'Bằng 0 lúc màn hình đứng yên là bình thường. Khi cuộn mà thấp hơn 50 là giật.', floor: 60 },
  { key: 'tempC', title: 'Nhiệt độ pin', unit: '°C', color: '#ff7a7a', hint: 'Tăng nhanh khi test lâu = app ngốn pin.', floor: 40, digits: 1 }
]

/** Downsample to at most `n` points, keeping the highest value of each bucket so spikes are not lost. */
function thin<T extends { v: number }>(pts: T[], n: number): T[] {
  if (pts.length <= n) return pts
  const k = pts.length / n
  const out: T[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * k)
    const b = Math.floor((i + 1) * k)
    let best = pts[a]
    for (let j = a; j < b; j++) if (pts[j].v > best.v) best = pts[j]
    out.push(best)
  }
  return out
}

function Chart({ s, samples, marks, from, to }: { s: Series; samples: LiveSample[]; marks: LiveMark[]; from: number; to: number }) {
  const W = 640
  const H = 110
  const PAD = { l: 38, r: 8, t: 8, b: 16 }
  const pts = useMemo(() => thin(samples.filter((x) => x[s.key] !== undefined).map((x) => ({ t: x.t, v: x[s.key] as number })), 320), [samples, s.key])
  const span = Math.max(1, to - from)
  const vals = pts.map((p) => p.v)
  const max = Math.max(s.floor ?? 1, ...vals) * 1.1
  const min = s.key === 'tempC' && vals.length ? Math.max(0, Math.min(...vals) - 2) : 0
  const x = (t: number): number => PAD.l + ((t - from) / span) * (W - PAD.l - PAD.r)
  const y = (v: number): number => PAD.t + (1 - (v - min) / Math.max(0.001, max - min)) * (H - PAD.t - PAD.b)
  // Break the line where the app was not running (no point for a while).
  const segs: string[] = []
  let cur: string[] = []
  let lastT = -1
  for (const p of pts) {
    if (lastT >= 0 && p.t - lastT > 6000) {
      if (cur.length) segs.push(cur.join(' '))
      cur = []
    }
    cur.push(`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    lastT = p.t
  }
  if (cur.length) segs.push(cur.join(' '))
  const last = vals.length ? vals[vals.length - 1] : undefined
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined
  const peak = vals.length ? Math.max(...vals) : undefined
  const fmt = (v?: number): string => (v === undefined ? '—' : v.toFixed(s.digits ?? (s.key === 'memMb' || s.key === 'cpu' || s.key === 'fps' ? 0 : 1)))
  return (
    <section className="pf-chart" aria-label={s.title}>
      <header>
        <b>{s.title}</b>
        <span className="pf-now" style={{ color: s.color }}>
          {fmt(last)} <small>{s.unit}</small>
        </span>
        <span className="pf-stat">
          trung bình {fmt(avg)} · cao nhất {fmt(peak)}
        </span>
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Biểu đồ ${s.title}`} preserveAspectRatio="none">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} className="pf-grid" />
            <text x={PAD.l - 4} y={PAD.t + f * (H - PAD.t - PAD.b) + 3} className="pf-axis" textAnchor="end">
              {(max - f * (max - min)).toFixed(max < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {marks
          .filter((m) => m.t >= from && m.t <= to)
          .map((m, i) => (
            <g key={i}>
              <line x1={x(m.t)} x2={x(m.t)} y1={PAD.t} y2={H - PAD.b} className="pf-mark" />
              <title>{m.text}</title>
            </g>
          ))}
        {segs.map((d, i) => (
          <polyline key={i} points={d} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
        <text x={PAD.l} y={H - 3} className="pf-axis">{fmtTime(from)}</text>
        <text x={W - PAD.r} y={H - 3} className="pf-axis" textAnchor="end">{fmtTime(to)}</text>
      </svg>
      <p className="pf-hint">{s.hint}</p>
    </section>
  )
}

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * "Hiệu năng": watch the app's memory, CPU, frame rate and the phone's battery live while you use it,
 * drop a flag at the moment something looks wrong, and save the numbers to Excel. Read-only.
 */
export function PerfPanel({ serial }: { serial: string }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('perfPkg') ?? localStorage.getItem('netPkg') ?? '')
  const [running, setRunning] = useState(false)
  const [samples, setSamples] = useState<LiveSample[]>([])
  const [marks, setMarks] = useState<LiveMark[]>([])
  const [markText, setMarkText] = useState('')
  const [view, setView] = useState<number>(() => Number(localStorage.getItem('perfView') ?? 60))
  const [err, setErr] = useState<string | null>(null)
  const t0 = useRef(0)
  const alive = useRef(false)

  useEffect(() => {
    if (pkg) localStorage.setItem('perfPkg', pkg)
  }, [pkg])
  useEffect(() => localStorage.setItem('perfView', String(view)), [view])

  // Sampling loop: one reading at a time (a reading takes a moment), at most once a second.
  useEffect(() => {
    if (!running || !pkg) return
    alive.current = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async (): Promise<void> => {
      const began = Date.now()
      try {
        const s = await window.api.perf.sample(serial, pkg, t0.current)
        if (!alive.current) return
        setErr(null)
        setSamples((all) => (all.length >= MAX_SAMPLES ? [...all.slice(all.length - MAX_SAMPLES + 1), s] : [...all, s]))
      } catch (e) {
        if (!alive.current) return
        setErr(window.api.perf ? (e as Error).message : 'Cửa sổ này đang chạy phần cũ của ADB Kit. Hãy đóng hẳn ADB Kit rồi mở lại.')
      }
      if (alive.current) timer = setTimeout(() => void tick(), Math.max(200, 1000 - (Date.now() - began)))
    }
    void tick()
    return () => {
      alive.current = false
      clearTimeout(timer)
    }
  }, [running, pkg, serial])

  const start = useCallback(async () => {
    if (!pkg) return
    if (samples.length === 0) t0.current = Date.now()
    else t0.current = Date.now() - samples[samples.length - 1].t // continue the same time axis
    await window.api.perf.reset(serial, pkg).catch(() => {})
    setRunning(true)
  }, [pkg, samples, serial])

  const clear = (): void => {
    setSamples([])
    setMarks([])
    setErr(null)
  }

  const now = samples.length ? samples[samples.length - 1].t : 0
  const addMark = (): void => {
    if (!running) return
    const text = markText.trim() || `Đánh dấu ${marks.length + 1}`
    setMarks((m) => [...m, { t: Date.now() - t0.current, text }])
    setMarkText('')
  }

  const save = async (): Promise<void> => {
    try {
      const p = await window.api.perf.exportCsv(pkg, samples, marks)
      if (p) await tell(`Đã lưu số liệu:\n${p}\n\nMở bằng Excel: mỗi dòng là một giây, cột “ghi chú” có các dấu bạn đã đánh.`, { title: 'Đã lưu' })
    } catch (e) {
      await tell((e as Error).message, { title: 'Không lưu được' })
    }
  }

  const to = now
  const from = view ? Math.max(0, to - view * 1000) : 0
  const shown = useMemo(() => samples.filter((s) => s.t >= from), [samples, from])
  const remarks = useMemo(() => liveRemarks(samples), [samples.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const latest = samples.length ? samples[samples.length - 1] : null
  const notRunning = running && latest && !latest.running

  return (
    <div className="panel wide pf-panel">
      <div className="log-tools">
        <PackagePicker serial={serial} value={pkg} onChange={(p) => { if (running) setRunning(false); setPkg(p); clear() }} placeholder="Chọn app cần theo dõi…" style={{ width: 260 }} />
        {!running ? (
          <button className="iconbtn primary" disabled={!pkg} onClick={() => void start()} title={pkg ? 'Bắt đầu đo (chỉ đọc, không thay đổi gì trên máy)' : 'Chọn app trước'}>
            <Play size={13} /> {samples.length ? 'Đo tiếp' : 'Bắt đầu đo'}
          </button>
        ) : (
          <button className="iconbtn danger-outline" onClick={() => setRunning(false)}>
            <Square size={13} /> Dừng
          </button>
        )}
        <select className="input sm" value={view} onChange={(e) => setView(Number(e.target.value))} aria-label="Khoảng thời gian hiển thị">
          {VIEWS.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
        <span className="spacer" style={{ flex: 1 }} />
        {latest?.battery !== undefined && <span className="devchip" title="Pin của điện thoại">Pin {latest.battery}%</span>}
        <button className="iconbtn" disabled={!samples.length} onClick={() => void save()} title="Lưu số liệu ra file CSV để mở bằng Excel">
          <Download size={13} /> Lưu CSV
        </button>
        <button className="iconbtn" disabled={!samples.length || running} onClick={clear} title="Xóa số liệu đã đo">
          <Trash2 size={13} /> Xóa
        </button>
      </div>

      {running && (
        <div className="pf-markbar">
          <Flag size={13} />
          <input
            className="input sm"
            value={markText}
            placeholder="Ghi chú rồi bấm Đánh dấu khi vừa làm gì đó (vd. mở Giỏ hàng)…"
            onChange={(e) => setMarkText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMark()}
            aria-label="Ghi chú cho dấu đánh"
          />
          <button className="iconbtn" onClick={addMark}>Đánh dấu</button>
          <span className="muted">{marks.length ? `${marks.length} dấu` : ''}</span>
        </div>
      )}
      {err && <div className="log-meta bad">{err}</div>}
      {notRunning && <div className="log-meta">App chưa chạy hoặc đã bị tắt — hãy mở app trên điện thoại, số liệu sẽ tự xuất hiện.</div>}

      <div className="panel-body pf-body">
        {samples.length === 0 && !running ? (
          <div className="pf-empty">
            <Gauge size={28} />
            <b>Xem app “khỏe” hay “mệt” khi bạn dùng nó</b>
            <ol>
              <li>Chọn app ở phía trên rồi bấm <b>Bắt đầu đo</b>.</li>
              <li>Dùng app trên điện thoại như bình thường. Mỗi giây có một điểm mới trên biểu đồ.</li>
              <li>Khi vừa làm gì đó đáng ngờ, ghi chú và bấm <b>Đánh dấu</b> để dễ tìm lại.</li>
              <li>Bấm <b>Lưu CSV</b> để gửi số liệu cho dev hoặc đính vào báo cáo lỗi.</li>
            </ol>
            <p>Chỉ đọc số liệu — không thay đổi gì trên điện thoại và dùng được cho mọi app.</p>
          </div>
        ) : (
          <>
            {remarks.length > 0 && (
              <div className="pf-remarks" role="status">
                <b>Đáng chú ý</b>
                <ul>
                  {remarks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {running && samples.length === 0 && (
              <div className="log-meta">
                <Loader2 size={12} className="spin" /> Đang lấy số liệu đầu tiên…
              </div>
            )}
            <div className="pf-grid2">
              {SERIES.map((s) => (
                <Chart key={s.key} s={s} samples={shown} marks={marks} from={from} to={Math.max(to, from + 10_000)} />
              ))}
            </div>
            {marks.length > 0 && (
              <div className="pf-marks">
                <b>Các dấu đánh</b>
                {marks.map((m, i) => (
                  <span key={i} className="sx-chip">
                    {fmtTime(m.t)} · {m.text}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
