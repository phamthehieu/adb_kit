import { useEffect, useState } from 'react'
import { Loader2, MonitorSmartphone, Square, Trash2 } from 'lucide-react'
import { DEFAULT_DESK, fmtRate, fmtTokens, normalizeDesk, normalizeRepo, type CiState, type DeskConfig, type DeskSnapshot, type DeskStatus, type DeskVia, type DeskWidgets } from '@shared/desk'

const load = (): DeskConfig => {
  try {
    return normalizeDesk(JSON.parse(localStorage.getItem('deskConfig') ?? 'null'))
  } catch {
    return DEFAULT_DESK
  }
}

const WIDGETS: { id: keyof DeskWidgets; label: string; hint: string }[] = [
  { id: 'clock', label: 'Đồng hồ', hint: 'Giờ và ngày, theo đồng hồ của điện thoại.' },
  { id: 'cpu', label: 'CPU', hint: 'Phần trăm CPU của máy tính và biểu đồ một phút gần nhất.' },
  { id: 'ram', label: 'RAM', hint: 'Bộ nhớ máy tính đang dùng trên tổng số.' },
  { id: 'gpu', label: 'GPU', hint: 'Phần trăm card đồ họa đang dùng (hiện có trên Windows).' },
  { id: 'net', label: 'Tốc độ mạng', hint: 'Tốc độ tải xuống và tải lên của máy tính (Windows, Linux).' },
  { id: 'battery', label: 'Pin laptop', hint: 'Phần trăm pin và trạng thái sạc. Máy bàn không có pin thì ô này tự ẩn.' },
  { id: 'media', label: 'Nhạc đang phát', hint: 'Tên bài, ca sĩ và tiến độ của bài đang phát trên máy tính (Windows: Spotify, trình duyệt, YouTube Music…).' },
  { id: 'ci', label: 'Trạng thái build CI', hint: 'Lần chạy GitHub Actions mới nhất của repo bạn nhập bên dưới.' },
  { id: 'ai', label: 'Token AI', hint: 'Số token đã dùng hôm nay và trong 5 giờ qua của Claude Code và Antigravity (Gemini), đọc từ nhật ký của chúng trên máy này. Chỉ lấy con số, không đọc nội dung hội thoại.' }
]
const VIAS: { id: DeskVia; label: string; hint: string }[] = [
  { id: 'app', label: 'App của ADB Kit (nên dùng)', hint: 'Toàn màn hình thật, không có thanh địa chỉ, tự giữ màn hình sáng. ADB Kit cài một app nhỏ lên máy ở lần bật đầu tiên.' },
  { id: 'browser', label: 'Trình duyệt', hint: 'Không cài gì lên máy. Trang mở trong trình duyệt của điện thoại nên còn thanh địa chỉ cho tới khi vào toàn màn hình.' }
]
const CI_TEXT: Record<CiState, string> = { success: 'thành công', failure: 'thất bại', running: 'đang chạy', queued: 'đang chờ', cancelled: 'đã hủy', other: 'đã xong' }
const DIMS = [100, 70, 45]
const gb = (b: number): string => (b / 1073741824).toFixed(1).replace('.', ',')

/**
 * "Bảng theo dõi": while a phone is plugged in but not being tested, its browser shows live
 * information about this PC. Display only; nothing is installed and no phone setting changes.
 */
export function DeskPanel({ serial }: { serial: string }) {
  const [config, setConfig] = useState<DeskConfig>(load)
  const [status, setStatus] = useState<DeskStatus | null>(null)
  const [snap, setSnap] = useState<DeskSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [repo, setRepo] = useState(config.ciRepo)

  useEffect(() => {
    let live = true
    const poll = (): void => {
      window.api.desk
        ?.state()
        .then((s) => {
          if (!live) return
          setStatus(s.status)
          setSnap(s.snapshot)
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 1500)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('deskConfig', JSON.stringify(config))
    void window.api.desk?.setConfig(config)
  }, [config])

  const here = status?.serial === serial
  const toggle = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      if (here) {
        await window.api.desk.stop()
        setStatus(null)
      } else setStatus(await window.api.desk.start(serial, config))
    } catch (e) {
      setError(window.api.desk ? (e as Error).message : 'Cửa sổ này đang chạy phần cũ của ADB Kit. Hãy đóng hẳn ADB Kit rồi mở lại.')
    } finally {
      setBusy(false)
    }
  }
  const uninstall = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      setNote(await window.api.desk.uninstall(serial))
      setStatus((await window.api.desk.state()).status)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // An ADB Kit main process started before this change still sends one object here, not a list.
  const ai = Array.isArray(snap?.ai) ? snap.ai : undefined
  const stale = !!snap?.ai && !ai
  const all = (s: { input: number; output: number; cacheRead: number; cacheWrite: number }): number => s.input + s.output + s.cacheRead + s.cacheWrite

  return (
    <div className="panel wide dk-panel">
      <div className="panel-body pu-body dk-body">
        <section className="mini-sec">
          <div className="mini-head"><b>1. Chọn thông tin hiện trên điện thoại</b></div>
          <div className="dk-widgets">
            {WIDGETS.map((w) => (
              <label key={w.id} className="dk-widget" title={w.hint}>
                <input type="checkbox" checked={config.widgets[w.id]} onChange={(e) => setConfig((c) => ({ ...c, widgets: { ...c.widgets, [w.id]: e.target.checked } }))} />
                <span>
                  <b>{w.label}</b>
                  <small>{w.hint}</small>
                </span>
              </label>
            ))}
          </div>
          {config.widgets.ci && (
            <label className="pu-row">
              <span>Repo GitHub</span>
              <span className="dk-repo">
                <input
                  className="input"
                  value={repo}
                  placeholder="chủ/repo, ví dụ facebook/react"
                  spellCheck={false}
                  onChange={(e) => setRepo(e.target.value)}
                  onBlur={() => setConfig((c) => ({ ...c, ciRepo: normalizeRepo(repo) }))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <small className={repo.trim() && !normalizeRepo(repo) ? 'bad' : ''}>
                  {repo.trim() && !normalizeRepo(repo)
                    ? 'Chưa đúng dạng chủ/repo.'
                    : 'ADB Kit hỏi GitHub 2 phút một lần và chỉ gửi đi tên repo này. Repo riêng tư cần đã đăng nhập GitHub CLI (gh) trên máy tính.'}
                </small>
              </span>
            </label>
          )}
          <label className="pu-row">
            <span>Độ sáng trang</span>
            <select className="input sm" value={config.dim} onChange={(e) => setConfig((c) => ({ ...c, dim: Number(e.target.value) }))}>
              {DIMS.map((d) => (
                <option key={d} value={d}>{d === 100 ? 'Bình thường' : `Giảm còn ${d}%`}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="mini-sec">
          <div className="mini-head"><b>2. Cách hiện trên điện thoại</b></div>
          <div className="pu-taps" role="radiogroup" aria-label="Cách hiện trên điện thoại">
            {VIAS.map((v) => (
              <button key={v.id} role="radio" aria-checked={config.via === v.id} disabled={here} className={`pu-tap ${config.via === v.id ? 'on' : ''}`} onClick={() => setConfig((c) => ({ ...c, via: v.id }))}>
                <b>{v.label}</b>
                <span>{v.hint}</span>
              </button>
            ))}
          </div>
          {config.via === 'browser' && (
            <label className="mini-check" title="Trình duyệt chỉ vào toàn màn hình sau một lần chạm. Khi trang đã mở, ADB Kit chạm một lần vào giữa màn hình để ẩn thanh địa chỉ.">
              <input type="checkbox" checked={config.autoFull} onChange={(e) => setConfig((c) => ({ ...c, autoFull: e.target.checked }))} />
              Tự vào toàn màn hình (ADB Kit chạm một lần vào giữa màn hình sau khi trang mở)
            </label>
          )}
          <label className="mini-check" title="Khi đóng ADB Kit lúc bảng đang bật: đóng bảng trên điện thoại rồi tắt màn hình máy.">
            <input type="checkbox" checked={config.sleepOnQuit} onChange={(e) => setConfig((c) => ({ ...c, sleepOnQuit: e.target.checked }))} />
            Đóng ADB Kit thì tắt luôn màn hình điện thoại
          </label>
          {here && <div className="sx-need">Tắt bảng theo dõi trước khi đổi cách hiện.</div>}
        </section>

        <section className="mini-sec">
          <div className="mini-head"><b>3. Hiện lên điện thoại</b></div>
          <div className="pu-actions">
            <button className={`iconbtn ${here ? '' : 'primary'}`} disabled={busy} onClick={() => void toggle()}>
              {busy ? <Loader2 size={13} className="spin" /> : here ? <Square size={13} /> : <MonitorSmartphone size={13} />} {here ? 'Tắt bảng theo dõi' : 'Bật bảng theo dõi'}
            </button>
            {here && <span className={`devchip ${status!.viewers ? '' : 'warn'}`}>{status!.viewers ? 'Điện thoại đang hiển thị' : 'Chưa thấy điện thoại mở trang'}</span>}
            {status && !here && <span className="devchip warn">Đang bật trên máy khác ({status.serial}); bật ở đây sẽ chuyển sang máy này</span>}
            <button className="iconbtn ghost" disabled={busy} onClick={() => void uninstall()} title="Gỡ app hiển thị của ADB Kit (dev.adbkit.desk) khỏi điện thoại này">
              <Trash2 size={13} /> Gỡ app khỏi điện thoại
            </button>
          </div>
          {error && <div className="sx-res bad">{error}</div>}
          {note && <div className="sx-res ok">{note}</div>}
          <div className="sx-need">
            {config.via === 'app'
              ? 'Lần đầu bấm Bật, ADB Kit cài app "ADB Kit Bảng theo dõi" (khoảng 25 KB, chỉ xin quyền mạng) lên máy này qua dây USB rồi mở nó toàn màn hình. Không đổi cài đặt nào của máy. Bấm Home để thoát.'
              : 'ADB Kit mở một trang trong trình duyệt của điện thoại qua dây USB. Không cài app, không đổi cài đặt nào của máy. Bấm Home để thoát.'}
          </div>
        </section>

        {here && snap && (
          <section className="mini-sec">
            <div className="mini-head"><b>Đang gửi sang điện thoại</b><span className="muted">{snap.host}</span></div>
            <div className="dk-now">
              <span><b>{snap.cpu === undefined ? '—' : Math.round(snap.cpu)}%</b> CPU · {snap.cores} luồng</span>
              <span><b>{gb(snap.memUsed)}</b> / {gb(snap.memTotal)} GB RAM</span>
              {snap.gpu && <span><b>{Math.round(snap.gpu.load)}%</b> GPU · {snap.gpu.name}</span>}
              {snap.net && <span>Mạng: <b>↓ {fmtRate(snap.net.down)}</b> · ↑ {fmtRate(snap.net.up)}</span>}
              {snap.battery && <span>Pin: <b>{Math.round(snap.battery.level)}%</b>{snap.battery.charging ? ' · đang sạc' : ''}</span>}
              {snap.media && <span>Nhạc: <b>{snap.media.title}</b>{snap.media.artist ? ` · ${snap.media.artist}` : ''}{snap.media.playing ? '' : ' (tạm dừng)'}</span>}
              {config.widgets.media && !snap.media && <span className="muted">Nhạc: không có gì đang phát.</span>}
              {snap.ci && <span>CI {snap.ci.repo}: <b>{CI_TEXT[snap.ci.state]}</b>{snap.ci.title ? ` · ${snap.ci.title}` : ''}</span>}
              {config.widgets.ci && config.ciRepo && !snap.ci && <span className="muted">CI: chưa lấy được lần chạy nào của {config.ciRepo}.</span>}
              {ai?.map((x) => (
                <span key={x.id}>
                  {x.name}: <b>{fmtTokens(all(x.usage.today))}</b> token hôm nay · {fmtTokens(all(x.usage.recent))} trong 5 giờ qua · {x.usage.active} phiên đang chạy
                </span>
              ))}
              {stale && <span className="muted">Cửa sổ này đang chạy phần cũ của ADB Kit. Hãy đóng hẳn ADB Kit rồi mở lại để thấy các ô mới.</span>}
              {config.widgets.ai && !ai && !stale && <span className="muted">Đang đọc nhật ký của các công cụ AI…</span>}
              {config.widgets.ai && ai?.length === 0 && <span className="muted">Không thấy nhật ký Claude Code hay Antigravity trên máy tính này.</span>}
            </div>
          </section>
        )}

        <details className="pu-note">
          <summary>Số token AI lấy từ đâu, có chính xác không?</summary>
          <p>
            Từ nhật ký trên máy tính này của Claude Code (thư mục <code>.claude/projects</code>) và Antigravity (<code>.gemini/antigravity</code>). Công cụ nào chưa từng dùng trên máy thì không hiện. ADB Kit chỉ cộng các con số token của từng câu trả lời, không lưu và không hiển thị nội dung hội thoại, và không gửi gì ra ngoài.
          </p>
          <p>
            Đây là số token đã dùng, không phải hạn mức còn lại của gói: các công cụ này không ghi hạn mức ra máy. Phiên chạy trên máy khác hoặc trên web không được tính. Các công cụ khác (Codex, Copilot, Cursor…) chưa được hỗ trợ.
          </p>
        </details>
      </div>
    </div>
  )
}
