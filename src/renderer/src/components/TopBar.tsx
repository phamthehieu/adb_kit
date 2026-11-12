import { useEffect, useRef, useState } from 'react'
import { Plus, Settings2, Smartphone, Usb, Wifi } from 'lucide-react'
import type { CmdResult, DeviceInfo, MirrorOptions } from '@shared/types'

function usePopover(): [boolean, (v: boolean) => void, React.RefObject<HTMLDivElement | null>] {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  return [open, setOpen, ref]
}

interface Props {
  devices: DeviceInfo[]
  active: string | null
  onSelect: (serial: string) => void
  options: MirrorOptions
  onOptions: (o: MirrorOptions) => void
  /** Info and actions about the selected phone (model chip, Wi-Fi switch), shown before the settings button. */
  extra?: React.ReactNode
}

export function TopBar({ devices, active, onSelect, options, onOptions, extra }: Props) {
  return (
    <div className="topbar">
      <div className="logo">
        <Smartphone size={16} />
        ADB KIT <small>DESKTOP</small>
      </div>
      <div className="tabs">
        {devices.map((d) => (
          <div
            key={d.serial}
            className={`tab ${d.serial === active ? 'active' : ''}`}
            role="tab"
            tabIndex={0}
            aria-selected={d.serial === active}
            onClick={() => onSelect(d.serial)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(d.serial)
              }
            }}
            title={`${d.model} — ${d.serial} (${d.state})`}
          >
            <span className={`dot ${d.state !== 'device' ? 'warn' : ''}`} />
            {d.transport === 'wifi' ? <Wifi size={12} /> : <Usb size={12} />}
            <span>{d.model}</span>
            <span className="serial">{d.serial}</span>
            {d.state !== 'device' && <span className="kind">{d.state}</span>}
          </div>
        ))}
        <ConnectButton />
      </div>
      {extra}
      <SettingsButton options={options} onOptions={onOptions} />
    </div>
  )
}

function ConnectButton() {
  const [open, setOpen, ref] = usePopover()
  const [addr, setAddr] = useState('')
  const [pairAddr, setPairAddr] = useState('')
  const [code, setCode] = useState('')
  const [out, setOut] = useState<CmdResult | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async (fn: () => Promise<CmdResult>): Promise<void> => {
    setBusy(true)
    setOut(null)
    try {
      setOut(await fn())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pop-wrap" ref={ref}>
      <button className="iconbtn ghost" title="Kết nối thiết bị qua Wi-Fi" onClick={() => setOpen(!open)}>
        <Plus size={15} />
      </button>
      {open && (
        <div className="popover left">
          <h4>Kết nối qua Wi-Fi</h4>
          <div className="row">
            <input className="input" placeholder="192.168.1.20:5555" value={addr} onChange={(e) => setAddr(e.target.value)} />
            <button className="iconbtn primary" disabled={busy || !addr} onClick={() => go(() => window.api.connect(addr.trim()))}>
              Kết nối
            </button>
          </div>
          <h4>Ghép đôi (Android 11+ — Gỡ lỗi không dây)</h4>
          <div className="row">
            <input className="input" placeholder="ip:cổng-ghép-đôi" value={pairAddr} onChange={(e) => setPairAddr(e.target.value)} />
            <input className="input" placeholder="mã" value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 80 }} />
            <button className="iconbtn" disabled={busy || !pairAddr || !code} onClick={() => go(() => window.api.pair(pairAddr.trim(), code.trim()))}>
              Ghép đôi
            </button>
          </div>
          <div className="note">
            Android 10 trở xuống: cắm cáp USB rồi bấm “Chuyển sang Wi-Fi” trên thanh công cụ.
          </div>
          {out && <div className={`out ${out.ok ? 'ok' : 'err'}`}>{out.output || (out.ok ? 'Thành công' : 'Thất bại')}</div>}
        </div>
      )}
    </div>
  )
}

function SettingsButton({ options, onOptions }: { options: MirrorOptions; onOptions: (o: MirrorOptions) => void }) {
  const [open, setOpen, ref] = usePopover()
  const sel = <K extends 'maxSize' | 'bitRate' | 'maxFps'>(k: K, label: string, values: [number, string][]) => (
    <label className="field">
      {label}
      <select className="input" value={options[k]} onChange={(e) => onOptions({ ...options, [k]: Number(e.target.value) })}>
        {values.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    </label>
  )
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="iconbtn" title="Cài đặt mirror" onClick={() => setOpen(!open)}>
        <Settings2 size={14} />
      </button>
      {open && (
        <div className="popover">
          <h4>Mirror màn hình</h4>
          {sel('maxSize', 'Độ phân giải tối đa (cạnh dài)', [[720, '720p'], [1024, '1024'], [1280, '1280'], [1600, '1600'], [1920, '1920'], [0, 'Gốc']])}
          {sel('bitRate', 'Bitrate', [[2_000_000, '2 Mbps'], [4_000_000, '4 Mbps'], [8_000_000, '8 Mbps'], [16_000_000, '16 Mbps']])}
          {sel('maxFps', 'FPS tối đa', [[30, '30'], [60, '60'], [90, '90'], [120, '120']])}
          <label className="field">
            Codec video
            <select
              className="input"
              value={options.codec === 'h265' ? 'h265' : 'h264'}
              onChange={(e) => onOptions({ ...options, codec: e.target.value as 'h264' | 'h265' })}
            >
              <option value="h264">H.264 (mặc định, ổn định)</option>
              <option value="h265">H.265 (thử nghiệm, nhẹ hơn)</option>
            </select>
          </label>
          <label className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={options.clipboardSync === true}
              onChange={(e) => onOptions({ ...options, clipboardSync: e.target.checked })}
            />
            Đồng bộ clipboard điện thoại → PC
          </label>
          <label className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={options.showTouches === true}
              onChange={(e) => onOptions({ ...options, showTouches: e.target.checked })}
            />
            Hiện điểm chạm (chấm trên mirror + trên điện thoại khi chạm tay thật)
          </label>
          <label className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={options.powerOffOnClose === true}
              onChange={(e) => onOptions({ ...options, powerOffOnClose: e.target.checked })}
            />
            Tắt màn hình điện thoại khi đóng mirror
          </label>
          <div className="note">Đổi giá trị sẽ khởi động lại mirror.</div>
        </div>
      )}
    </div>
  )
}
