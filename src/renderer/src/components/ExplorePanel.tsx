import { useEffect, useState } from 'react'
import { Compass, ExternalLink, Loader2, Play, Square } from 'lucide-react'
import type { ExploreProgress } from '../../../main/explore'
import { autoStore } from '../lib/automation'
import { PackagePicker } from './PackagePicker'

/** "Tự khám phá": let ADB Kit walk the app on its own and report screens, crashes, UI issues. */
export function ExplorePanel({ serial }: { serial: string }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('explorePkg') ?? localStorage.getItem('netPkg') ?? '')
  const [minutes, setMinutes] = useState(() => Number(localStorage.getItem('exploreMin') ?? 5) || 5)
  const [avoid, setAvoid] = useState(() => localStorage.getItem('exploreAvoid') ?? '')
  const [running, setRunning] = useState(false)
  const [p, setP] = useState<ExploreProgress | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => window.api.suite.onExplore(setP), [])

  const start = async (): Promise<void> => {
    if (!confirm(`ADB Kit sẽ tự bấm khắp app ${pkg} trong ${minutes} phút (bỏ qua nút đăng xuất, xóa, thanh toán, chuyển tiền, gọi…).\n\nNên dùng tài khoản test và để điện thoại yên trong lúc chạy. Bắt đầu?`)) return
    localStorage.setItem('explorePkg', pkg)
    localStorage.setItem('exploreMin', String(minutes))
    localStorage.setItem('exploreAvoid', avoid)
    setErr('')
    setP(null)
    setRunning(true)
    autoStore.set({ running: true, unlocked: false, recording: false, inspecting: false, highlight: null })
    try {
      await window.api.suite.explore(serial, pkg, { minutes, maxActions: Math.max(50, minutes * 60), avoid })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRunning(false)
      autoStore.set({ running: false, unlocked: false })
    }
  }

  const sec = Math.round((p?.elapsed ?? 0) / 1000)
  return (
    <div className="steps explore">
      <div className="mini-sec">
        <div className="mini-head">
          <Compass size={14} />
          <b>Tự khám phá app</b>
          <span className="muted">không cần viết kịch bản — tự bấm từng nút, vào từng màn, rồi quay lại</span>
        </div>
        <div className="ck-grid">
          <span>App</span>
          <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="App cần khám phá…" />
          <span>Thời gian</span>
          <div className="ck-line">
            <input className="input sm num" type="number" min={1} max={120} value={minutes} disabled={running} onChange={(e) => setMinutes(Math.max(1, Math.min(120, +e.target.value || 5)))} />
            <span className="muted">phút (tối đa ~{Math.max(50, minutes * 60)} thao tác)</span>
          </div>
          <span>Không bấm thêm</span>
          <input className="input" value={avoid} disabled={running} onChange={(e) => setAvoid(e.target.value)} placeholder="các chữ cách nhau dấu phẩy, vd: Gửi yêu cầu, Đổi mật khẩu" />
        </div>
        <div className="bug-actions">
          <span className="muted">Mẹo: bật "Thử chữ to 1.3×" (tab Soát UI) hoặc "Mạng chập chờn" (tab Mạng) trước khi chạy để tìm thêm lỗi.</span>
          <span className="spacer" />
          {running ? (
            <button className="iconbtn danger-solid" onClick={() => void window.api.suite.stopExplore()}>
              <Square size={12} /> Dừng
            </button>
          ) : (
            <button className="iconbtn primary" disabled={!pkg} onClick={() => void start()}>
              <Play size={12} /> Bắt đầu khám phá
            </button>
          )}
        </div>
      </div>

      {p && (
        <div className="mini-sec">
          <div className="ex-stats">
            <div><b>{p.screens}</b><span>màn hình</span></div>
            <div><b>{p.actions}</b><span>thao tác</span></div>
            <div className={p.crashes ? 'bad' : ''}><b>{p.crashes}</b><span>crash / ANR</span></div>
            <div className={p.issues ? 'warn' : ''}><b>{p.issues}</b><span>vấn đề giao diện</span></div>
            <div><b>{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</b><span>đã chạy</span></div>
          </div>
          <div className="muted ex-now">
            {running && !p.done && <Loader2 size={12} className="spin" />} {p.current}
          </div>
          {p.error && <div className="ck-note bad">{p.error}</div>}
          {p.html && (
            <div className="bug-actions">
              <span className="spacer" />
              <button className="iconbtn primary" onClick={() => void window.api.openPath(p.html!)}>
                <ExternalLink size={12} /> Mở báo cáo khám phá
              </button>
            </div>
          )}
        </div>
      )}
      {err && <div className="ck-note bad">{err}</div>}
    </div>
  )
}
