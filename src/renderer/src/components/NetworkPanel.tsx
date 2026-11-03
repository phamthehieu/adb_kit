import { useEffect, useMemo, useRef, useState } from 'react'
import { Eraser, ListPlus, Pause, Play, RotateCcw, WifiOff, X } from 'lucide-react'
import { NET_PROFILES, callFailed, describeMock, emptyScript, type MockRule, type NetCall, type NetProfile, type Script, type Step } from '@shared/automation'
import { PackagePicker } from './PackagePicker'

type Kind = 'all' | 'http' | 'ipc'

function pretty(s?: string): string {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

/** Shorter label for long SQL / URLs in the list. */
function summary(c: NetCall): string {
  if (c.kind === 'ipc' && c.url.startsWith('plugin:sql|') && c.args) {
    try {
      const q = JSON.parse(c.args).query as string
      if (q) return `${c.url}  ${q.replace(/\s+/g, ' ').slice(0, 140)}`
    } catch {
      /* not JSON */
    }
  }
  return c.url
}

function kindLabel(c: NetCall): string {
  if (c.source === 'bridge') return c.kind === 'http' ? 'HTTP·Bridge' : c.method === 'event' ? 'Sự kiện' : 'Bridge'
  if (c.kind === 'ipc') return 'Lệnh'
  return c.viaTauri ? 'HTTP·Rust' : c.source === 'chucker' ? 'HTTP·App' : 'HTTP'
}

function kindTitle(c: NetCall): string | undefined {
  if (c.source === 'chucker') return 'Đọc từ Chucker của app native'
  if (c.source === 'bridge') {
    return c.kind === 'http'
      ? 'Miniapp gọi API qua native (WVFetch) — không đi qua mạng của WebView'
      : c.method === 'event'
        ? 'Native báo sự kiện cho miniapp'
        : 'Miniapp gọi hàm native qua bridge (JSAPI)'
  }
  return undefined
}

/** Append a step to the script stored for the "Tự động test" panel. */
function addToScript(step: Step): void {
  let s: Script
  try {
    s = { ...emptyScript(), ...JSON.parse(localStorage.getItem('autoScript') ?? '{}') }
  } catch {
    s = emptyScript()
  }
  s.steps = [...s.steps, step]
  localStorage.setItem('autoScript', JSON.stringify(s))
}

export function NetworkPanel({ serial }: { serial: string }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('netPkg') ?? '')
  const [calls, setCalls] = useState<Map<string, NetCall>>(new Map())
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [kind, setKind] = useState<Kind>('all')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [info, setInfo] = useState<string[]>([])
  const [mocks, setMocksState] = useState<MockRule[]>([])

  const setMocks = async (rules: MockRule[]): Promise<void> => {
    try {
      await window.api.net.setMocks(rules)
      setMocksState(rules)
    } catch (e) {
      setInfo((l) => [...l.slice(-4), `Không đặt được giả lập: ${(e as Error).message}`])
    }
  }
  const mockFor = (c: NetCall, action: MockRule['action']): void => {
    const match = c.kind === 'ipc' ? c.url : c.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || c.url
    const rule: MockRule =
      action === 'delay'
        ? { match, kind: c.kind, action, delayMs: 5000 }
        : action === 'status'
          ? { match, kind: c.kind, action, status: 500, body: '{"error":"ADB Kit giả lập"}' }
          : { match, kind: c.kind, action, body: 'ADB Kit: lỗi giả lập' }
    void setMocks([...mocks, rule])
  }
  // Bad network for every API call of the watched app.
  const [profile, setProfileState] = useState<NetProfile['mode'] | ''>('')
  const setProfile = async (mode: NetProfile['mode'] | ''): Promise<void> => {
    try {
      await window.api.net.setProfile(mode ? NET_PROFILES[mode].profile : null)
      setProfileState(mode)
      setInfo((l) => [...l.slice(-4), mode ? `Đang giả lập: ${NET_PROFILES[mode].label} — áp cho mọi API của app (tự hết sau 15 phút)` : 'Mạng trở lại bình thường'])
    } catch (e) {
      setInfo((l) => [...l.slice(-4), `Không đặt được: ${(e as Error).message}`])
    }
  }
  // Real network cut for the whole phone (Wi-Fi + data), switched back on by the phone itself.
  const [cutSec, setCutSec] = useState(10)
  const [cutUntil, setCutUntil] = useState(0)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!cutUntil) return
    const t = setInterval(() => {
      tick((n) => n + 1)
      if (Date.now() > cutUntil + 3000) setCutUntil(0)
    }, 500)
    return () => clearInterval(t)
  }, [cutUntil])
  const cut = async (): Promise<void> => {
    try {
      const r = await window.api.net.cut(serial, cutSec)
      setCutUntil(r.until)
      setInfo((l) => [...l.slice(-4), `Đã tắt Wi-Fi + dữ liệu di động của máy trong ${cutSec} giây — máy tự bật lại`])
    } catch (e) {
      setInfo((l) => [...l.slice(-4), (e as Error).message])
    }
  }
  const cutLeft = cutUntil ? Math.max(0, Math.ceil((cutUntil - Date.now()) / 1000)) : 0

  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    const off1 = window.api.net.onCalls((batch) => {
      if (pausedRef.current) return
      setCalls((m) => {
        const n = new Map(m)
        for (const c of batch) n.set(c.id, c)
        // Keep memory bounded on chatty apps.
        if (n.size > 3000) [...n.keys()].slice(0, n.size - 3000).forEach((k) => n.delete(k))
        return n
      })
    })
    const off2 = window.api.net.onInfo((m) => setInfo((l) => [...l.slice(-4), m]))
    return () => {
      off1()
      off2()
      void window.api.net.stop()
    }
  }, [])

  // (Re)start watching when the app changes.
  useEffect(() => {
    if (!pkg) return
    localStorage.setItem('netPkg', pkg)
    setCalls(new Map())
    setInfo([])
    setSel(null)
    setProfileState('') // a new watcher starts with a normal network
    setRunning(true)
    void window.api.net.start(serial, pkg)
  }, [serial, pkg])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...calls.values()]
      .filter((c) => (kind === 'all' || c.kind === kind) && (!onlyErrors || callFailed(c)) && (!q || summary(c).toLowerCase().includes(q)))
      .sort((a, b) => a.startedAt - b.startedAt)
  }, [calls, kind, onlyErrors, query])

  const selected = sel ? calls.get(sel) : undefined
  const t0 = list[0]?.startedAt ?? 0
  const errCount = useMemo(() => [...calls.values()].filter(callFailed).length, [calls])

  const makeStep = (c: NetCall): void => {
    // Match on the path (or command), not the full URL with query string / host.
    const match = c.kind === 'ipc' ? c.url : c.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || c.url
    addToScript({ type: 'api', match, kind: c.kind, method: c.kind === 'http' ? c.method : undefined, status: 0, timeoutMs: 5000 })
    setInfo((l) => [...l.slice(-4), `Đã thêm bước "Kiểm tra API ${match}" vào kịch bản (tab Tự động test)`])
  }

  const stop = async (): Promise<void> => {
    await window.api.net.stop()
    setRunning(false)
    setProfileState('')
  }

  return (
    <div className="panel wide">
      <div className="log-tools">
        <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="Chọn app cần theo dõi…" style={{ width: 260 }} />
        {running ? (
          <button className="iconbtn" onClick={stop} title="Ngừng theo dõi"><X size={13} /> Ngừng</button>
        ) : (
          <button className="iconbtn" disabled={!pkg} onClick={() => { setRunning(true); void window.api.net.start(serial, pkg) }}>
            <Play size={13} /> Theo dõi
          </button>
        )}
        <button
          className="iconbtn"
          disabled={!running}
          onClick={() => void window.api.net.reload(serial, pkg)}
          title="Tải lại giao diện của app (app native: khởi động lại app) để bắt cả các API gọi lúc khởi động"
        >
          <RotateCcw size={13} /> Tải lại app
        </button>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="all">Tất cả</option>
          <option value="http">HTTP</option>
          <option value="ipc">Lệnh (Tauri / bridge miniapp)</option>
        </select>
        <input className="input search" placeholder="Lọc theo URL / lệnh / SQL…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={`iconbtn ${onlyErrors ? 'on' : ''}`} onClick={() => setOnlyErrors(!onlyErrors)} title="Chỉ hiện lỗi">
          Lỗi{errCount ? ` (${errCount})` : ''}
        </button>
        <button className={`iconbtn ${paused ? 'on' : ''}`} onClick={() => setPaused(!paused)}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
        <button className="iconbtn" title="Xóa danh sách" onClick={() => { setCalls(new Map()); setSel(null) }}><Eraser size={14} /></button>
      </div>
      <div className="log-tools net-sim">
        <span className="muted">Giả lập mạng cho app:</span>
        <select
          className={`input ${profile ? 'net-on' : ''}`}
          value={profile}
          disabled={!running}
          onChange={(e) => void setProfile(e.target.value as NetProfile['mode'] | '')}
          title="Áp cho mọi API của app đang theo dõi: fetch/XHR của WebView, API miniapp qua bridge (WVFetch), HTTP của Tauri. App native chỉ có Chucker thì không áp được — dùng Ngắt mạng thật."
        >
          <option value="">Bình thường</option>
          {(Object.keys(NET_PROFILES) as NetProfile['mode'][]).map((k) => (
            <option key={k} value={k}>{NET_PROFILES[k].label}</option>
          ))}
        </select>
        <span className="spacer" />
        <span className="muted">Mất mạng thật cả máy:</span>
        <select className="input" value={cutSec} onChange={(e) => setCutSec(Number(e.target.value))} disabled={cutLeft > 0}>
          {[5, 10, 30, 60].map((s) => (
            <option key={s} value={s}>{s} giây</option>
          ))}
        </select>
        <button
          className={`iconbtn ${cutLeft ? 'on' : ''}`}
          disabled={cutLeft > 0}
          onClick={() => void cut()}
          title="Tắt Wi-Fi và dữ liệu di động của điện thoại rồi tự bật lại — áp cho mọi app, kể cả app native. Chỉ dùng khi cắm cáp USB."
        >
          <WifiOff size={13} /> {cutLeft ? `Đang mất mạng… ${cutLeft}s` : 'Ngắt mạng'}
        </button>
      </div>
      <div className="log-meta">
        <span>{list.length} / {calls.size} lời gọi</span>
        {info.slice(-1).map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>

      {mocks.length > 0 && (
        <div className="mock-box">
          <div className="mrow">
            <b className="t">Đang giả lập {mocks.length} quy tắc — app sẽ nhận kết quả giả cho các lời gọi khớp (tự hết hạn sau 15 phút)</b>
            <button className="iconbtn" onClick={() => void setMocks([])}>Bỏ hết</button>
          </div>
          {mocks.map((m, i) => (
            <div key={i} className="mrow">
              <span className="t">{describeMock(m)}</span>
              <button className="iconbtn ghost" onClick={() => void setMocks(mocks.filter((_, k) => k !== i))}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="net-body">
        <div className="net-list">
          {!pkg && <div className="steps-empty">Chọn app để xem các request HTTP theo thời gian thực: app WebView/Tauri (cả lệnh JS → Rust) hoặc app native có Chucker. App cần là bản build debug.</div>}
          {pkg && calls.size === 0 && (
            <div className="steps-empty">
              Đang chờ… Thao tác trên app để thấy lời gọi, hoặc bấm <b>Tải lại app</b> để bắt cả những gì app gọi lúc khởi động.
            </div>
          )}
          {list.map((c) => (
            <div key={c.id} className={`net-row ${sel === c.id ? 'sel' : ''} ${callFailed(c) ? 'bad-row' : ''}`} onClick={() => setSel(c.id)}>
              <span className="nt">+{((c.startedAt - t0) / 1000).toFixed(1)}s</span>
              <span className={`nk ${c.kind}${c.source === 'bridge' && c.kind === 'ipc' ? ' bridge' : ''}`} title={kindTitle(c)}>
                {kindLabel(c)}
              </span>
              <span className="nm">{c.kind === 'http' ? c.method : ''}</span>
              {c.page && <span className="npg" title={`Gọi từ trang: ${c.page}`}>{c.page}</span>}
              {c.mocked && (
                <span className="mk" title={c.mocked.startsWith('mạng') ? `Bị ảnh hưởng bởi giả lập ${c.mocked}` : 'Kết quả do ADB Kit giả lập'}>
                  {c.mocked.startsWith('mạng') ? 'MẠNG' : 'GIẢ'}
                </span>
              )}
              <span className="nu" title={c.url}>{summary(c)}</span>
              <span className="ns">{c.status === undefined ? '…' : c.kind === 'ipc' ? (c.status === 200 ? 'ok' : 'lỗi') : c.status || 'lỗi'}</span>
              <span className="nd">{c.durationMs !== undefined ? `${c.durationMs} ms` : ''}</span>
            </div>
          ))}
        </div>
        {selected && (
          <div className="net-detail">
            <div className="nd-head">
              <b>
                {selected.kind === 'ipc'
                  ? selected.source === 'bridge' ? (selected.method === 'event' ? 'Sự kiện native → miniapp' : 'Lệnh bridge miniapp') : 'Lệnh Tauri'
                  : `${selected.method} ${selected.status ?? ''}`}
              </b>
              {selected.page && <span className="muted">· {selected.page}</span>}
              <span className="spacer" />
              <button className="iconbtn" onClick={() => makeStep(selected)} title="Thêm bước 'Kiểm tra API' khớp lời gọi này vào kịch bản">
                <ListPlus size={13} /> Tạo bước kiểm tra
              </button>
              {selected.source !== 'chucker' && (
                <>
                  <button className="iconbtn" onClick={() => mockFor(selected, 'error')} title="Từ giờ các lời gọi giống thế này sẽ bị lỗi (mất mạng / bị từ chối)">
                    Giả lập lỗi
                  </button>
                  {selected.kind === 'http' && !selected.viaTauri && (
                    <button className="iconbtn" onClick={() => mockFor(selected, 'status')} title="Trả về HTTP 500">
                      Giả lập 500
                    </button>
                  )}
                  <button className="iconbtn" onClick={() => mockFor(selected, 'delay')} title="Chậm 5 giây">
                    Giả lập chậm
                  </button>
                </>
              )}
              <button className="iconbtn ghost" onClick={() => setSel(null)}><X size={13} /></button>
            </div>
            <div className="nd-url">{selected.url}</div>
            {selected.error && <div className="bad">Lỗi: {selected.error}</div>}
            {selected.reqHeaders?.length ? (
              <details>
                <summary className="panel-title">Header gửi đi ({selected.reqHeaders.length})</summary>
                <pre>{selected.reqHeaders.map((h) => `${h.name}: ${h.value}`).join('\n')}</pre>
              </details>
            ) : null}
            {selected.args && (
              <>
                <div className="panel-title">Gửi đi</div>
                <pre>{pretty(selected.args)}</pre>
              </>
            )}
            {selected.resHeaders?.length ? (
              <details>
                <summary className="panel-title">Header nhận về ({selected.resHeaders.length})</summary>
                <pre>{selected.resHeaders.map((h) => `${h.name}: ${h.value}`).join('\n')}</pre>
              </details>
            ) : null}
            {selected.result && (
              <>
                <div className="panel-title">Nhận về</div>
                <pre>{pretty(selected.result)}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
