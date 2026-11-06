import { useEffect, useState } from 'react'
import { autoStore } from '../lib/automation'
import {
  DEVICE_PRESETS,
  type DevicePreset,
  type MatrixItem
} from '@shared/formfactors'
import {
  Camera,
  CheckCircle2,
  Expand,
  FoldHorizontal,
  Loader2,
  RotateCcw,
  Smartphone,
  Tablet,
  Wand2,
  X
} from 'lucide-react'

export function MatrixSection({ serial }: { serial: string }) {
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [matrixResults, setMatrixResults] = useState<MatrixItem[] | null>(null)
  const [modalItem, setModalItem] = useState<MatrixItem | null>(null)
  const [supportedCutouts, setSupportedCutouts] = useState<string[]>([])

  useEffect(() => {
    window.api.matrix.cutouts(serial).then(setSupportedCutouts).catch(() => {})
    return () => {
      autoStore.set({ activeCutout: null })
    }
  }, [serial])

  const apply = async (p: DevicePreset): Promise<void> => {
    setBusy(`apply_${p.id}`)
    setNote(null)
    try {
      const res = await window.api.matrix.apply(serial, p.id)
      if (!res.ok) {
        setNote({ text: res.message, bad: true })
        return
      }
      setActivePreset(p.id)
      autoStore.set({ activeCutout: p.category === 'cutout' ? p.id : null })
      setNote({ text: res.message })
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(null)
    }
  }

  const reset = async (): Promise<void> => {
    setBusy('reset')
    setNote(null)
    try {
      const res = await window.api.matrix.reset(serial)
      setActivePreset(null)
      autoStore.set({ activeCutout: null })
      setNote({ text: res.message })
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(null)
    }
  }

  const scan = async (): Promise<void> => {
    setBusy('scan')
    setNote(null)
    try {
      const items = await window.api.matrix.scan(serial)
      setMatrixResults(items)
      setActivePreset(null)
      setNote({ text: `Đã quét ma trận thành công (${items.length} kích thước)!` })
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(null)
    }
  }

  const foldables = DEVICE_PRESETS.filter((p) => p.category === 'foldable')
  const tablets = DEVICE_PRESETS.filter((p) => p.category === 'tablet')
  const phones = DEVICE_PRESETS.filter((p) => p.category === 'phone')
  const cutouts = DEVICE_PRESETS.filter((p) => p.category === 'cutout')

  return (
    <div className="matrix-section">
      <div className="matrix-head">
        <div>
          <b>Ma trận Đa màn hình & Thiết bị gập</b>
          <div className="muted text-xs">
            Ảo hóa kích thước màn hình gập, tablet, camera tai thỏ trực tiếp trên máy thật mà không cần cài máy ảo nặng.
          </div>
        </div>
        <div className="matrix-actions">
          {activePreset && (
            <button className="iconbtn warn" disabled={!!busy} onClick={() => void reset()} title="Đưa màn hình điện thoại về lại kích thước vật lý ban đầu">
              <RotateCcw size={13} /> Khôi phục màn hình gốc
            </button>
          )}
          <button
            className="iconbtn primary"
            disabled={!!busy}
            onClick={() => void scan()}
            title="Tự động biến đổi màn hình qua Z Fold Mở, Z Fold Gập, Tablet, Tai thỏ và chụp ảnh so sánh"
          >
            {busy === 'scan' ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
            {busy === 'scan' ? 'Đang quét ma trận…' : '⚡ Quét ma trận 4 màn hình'}
          </button>
        </div>
      </div>

      {note && <div className={`ck-note ${note.bad ? 'bad' : ''}`}>{note.text}</div>}

      {/* Kết quả quét ma trận */}
      {matrixResults && matrixResults.length > 0 && (
        <div className="matrix-gallery-box">
          <div className="matrix-gallery-header">
            <b>Kết quả quét ma trận giao diện ({matrixResults.length} màn hình)</b>
            <span className="muted text-xs">Bấm vào từng ảnh để phóng to và soi chi tiết</span>
          </div>
          <div className="matrix-gallery-grid">
            {matrixResults.map((item) => (
              <div key={item.id} className="matrix-card" onClick={() => setModalItem(item)}>
                <div className="matrix-card-thumb">
                  <img src={item.dataUrl} alt={item.name} />
                  <div className="matrix-card-overlay">
                    <Expand size={16} /> Phóng to
                  </div>
                </div>
                <div className="matrix-card-info">
                  <div className="matrix-card-title">{item.name}</div>
                  <div className="matrix-card-spec">
                    {item.width}×{item.height} ({item.dpWidth}×{item.dpHeight} dp)
                  </div>
                  <div className="matrix-card-desc">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danh mục Preset */}
      <div className="matrix-groups">
        {/* Nhóm Màn hình gập */}
        <div className="matrix-group">
          <div className="matrix-group-title">
            <FoldHorizontal size={15} /> <b>Màn hình gập (Foldable)</b>
          </div>
          <div className="matrix-preset-list">
            {foldables.map((p) => {
              const isCurrent = activePreset === p.id
              return (
                <div key={p.id} className={`matrix-preset-item ${isCurrent ? 'active' : ''}`}>
                  <div className="matrix-preset-text">
                    <div className="matrix-preset-name">
                      {p.name} {isCurrent && <CheckCircle2 size={13} className="text-accent" />}
                    </div>
                    <div className="matrix-preset-sub">{p.desc}</div>
                  </div>
                  <button
                    className={`iconbtn ${isCurrent ? 'ghost' : 'sm'}`}
                    disabled={!!busy}
                    onClick={() => void (isCurrent ? reset() : apply(p))}
                  >
                    {busy === `apply_${p.id}` ? <Loader2 size={12} className="spin" /> : isCurrent ? 'Khôi phục' : 'Thử'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Nhóm Tablet */}
        <div className="matrix-group">
          <div className="matrix-group-title">
            <Tablet size={15} /> <b>Máy tính bảng (Tablet)</b>
          </div>
          <div className="matrix-preset-list">
            {tablets.map((p) => {
              const isCurrent = activePreset === p.id
              return (
                <div key={p.id} className={`matrix-preset-item ${isCurrent ? 'active' : ''}`}>
                  <div className="matrix-preset-text">
                    <div className="matrix-preset-name">
                      {p.name} {isCurrent && <CheckCircle2 size={13} className="text-accent" />}
                    </div>
                    <div className="matrix-preset-sub">{p.desc}</div>
                  </div>
                  <button
                    className={`iconbtn ${isCurrent ? 'ghost' : 'sm'}`}
                    disabled={!!busy}
                    onClick={() => void (isCurrent ? reset() : apply(p))}
                  >
                    {busy === `apply_${p.id}` ? <Loader2 size={12} className="spin" /> : isCurrent ? 'Khôi phục' : 'Thử'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Nhóm Tỷ lệ đặc thù */}
        <div className="matrix-group">
          <div className="matrix-group-title">
            <Smartphone size={15} /> <b>Điện thoại đặc thù</b>
          </div>
          <div className="matrix-preset-list">
            {phones.map((p) => {
              const isCurrent = activePreset === p.id
              return (
                <div key={p.id} className={`matrix-preset-item ${isCurrent ? 'active' : ''}`}>
                  <div className="matrix-preset-text">
                    <div className="matrix-preset-name">
                      {p.name} {isCurrent && <CheckCircle2 size={13} className="text-accent" />}
                    </div>
                    <div className="matrix-preset-sub">{p.desc}</div>
                  </div>
                  <button
                    className={`iconbtn ${isCurrent ? 'ghost' : 'sm'}`}
                    disabled={!!busy}
                    onClick={() => void (isCurrent ? reset() : apply(p))}
                  >
                    {busy === `apply_${p.id}` ? <Loader2 size={12} className="spin" /> : isCurrent ? 'Khôi phục' : 'Thử'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Nhóm Khuyết đỉnh */}
        <div className="matrix-group">
          <div className="matrix-group-title">
            <Camera size={15} /> <b>Khuyết đỉnh & Viền cong (Display Cutouts)</b>
          </div>
          <div className="matrix-preset-list">
            {cutouts.map((p) => {
              const isCurrent = activePreset === p.id
              const isSupported = !p.cutout || supportedCutouts.length === 0 || supportedCutouts.includes(p.cutout)
              return (
                <div key={p.id} className={`matrix-preset-item ${isCurrent ? 'active' : ''} ${!isSupported ? 'dimmed' : ''}`}>
                  <div className="matrix-preset-text">
                    <div className="matrix-preset-name">
                      {p.name} {isCurrent && <CheckCircle2 size={13} className="text-accent" />}
                      {!isSupported && <span className="muted" style={{ fontSize: 10, fontWeight: 'normal' }}> · Cần Android 11+</span>}
                    </div>
                    <div className="matrix-preset-sub">{p.desc}</div>
                  </div>
                  <button
                    className={`iconbtn ${isCurrent ? 'ghost' : 'sm'}`}
                    disabled={!!busy || !isSupported}
                    onClick={() => void (isCurrent ? reset() : apply(p))}
                    title={!isSupported ? 'Thiết bị này chưa hỗ trợ kiểu cutout này (cần Android 11+)' : undefined}
                  >
                    {busy === `apply_${p.id}` ? <Loader2 size={12} className="spin" /> : isCurrent ? 'Tắt' : 'Bật'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Lightbox Modal để soi ảnh toàn màn hình */}
      {modalItem && (
        <div className="matrix-modal-backdrop" onClick={() => setModalItem(null)}>
          <div className="matrix-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="matrix-modal-header">
              <div>
                <b>{modalItem.name}</b> —{' '}
                <span className="muted">
                  {modalItem.width}×{modalItem.height} px ({modalItem.dpWidth}×{modalItem.dpHeight} dp)
                </span>
              </div>
              <button className="iconbtn ghost" onClick={() => setModalItem(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="matrix-modal-body">
              <img src={modalItem.dataUrl} alt={modalItem.name} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

