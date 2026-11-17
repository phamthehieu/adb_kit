import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { updateText, type UpdateInfo } from '@shared/update'
import { ask } from '../lib/dialog'

/** Current version + update state, kept in sync with the main process. */
function useUpdate(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.update.info().then((i) => alive && setInfo(i))
    const off = window.api.update.onState((state) => setInfo((i) => (i ? { ...i, state } : i)))
    return () => {
      alive = false
      off()
    }
  }, [])
  return info
}

async function install(version: string): Promise<void> {
  const ok = await ask(`Cài bản ${version}? ADB Kit sẽ đóng rồi tự mở lại. Lần chạy test hoặc phiên mirror đang dở sẽ dừng.`, { ok: 'Khởi động lại và cài' })
  if (ok) void window.api.update.install()
}

/** Top bar: shows up only when there is something to do (new build, download, ready to install). */
export function UpdateChip() {
  const info = useUpdate()
  const s = info?.state
  if (!info || !s) return null
  if (s.state === 'available')
    return (
      <button
        className="iconbtn on"
        onClick={() => void window.api.update.download()}
        title={
          s.mode === 'install'
            ? `Có bản mới ${s.version} (đang dùng ${info.current}). Bấm để tải về; chỉ cài khi bạn đồng ý khởi động lại.`
            : `Có bản mới ${s.version} (đang dùng ${info.current}). Bấm để mở trang tải.`
        }
      >
        <Download size={14} /> <span className="tl">Bản mới {s.version}</span>
      </button>
    )
  if (s.state === 'downloading')
    return (
      <span className="devchip" title={`Đang tải bản ${s.version}`}>
        Đang tải {s.percent}%
      </span>
    )
  if (s.state === 'ready')
    return (
      <button className="iconbtn on" onClick={() => void install(s.version)} title={`Bản ${s.version} đã tải xong. Bấm để khởi động lại và cài.`}>
        <RefreshCw size={14} /> <span className="tl">Cài bản {s.version}</span>
      </button>
    )
  return null
}

/** Settings popover: version in use and a manual check. */
export function UpdateRow() {
  const info = useUpdate()
  if (!info) return null
  const s = info.state
  const busy = s.state === 'checking' || s.state === 'downloading'
  return (
    <div className="note" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <span>{updateText(info)}</span>
      {s.state === 'available' ? (
        <button className="iconbtn" onClick={() => void window.api.update.download()}>
          {s.mode === 'install' ? 'Tải về' : 'Mở trang tải'}
        </button>
      ) : s.state === 'ready' ? (
        <button className="iconbtn" onClick={() => void install(s.version)}>
          Cài
        </button>
      ) : (
        <button className="iconbtn" disabled={busy} onClick={() => void window.api.update.check()}>
          Kiểm tra bản mới
        </button>
      )}
    </div>
  )
}
