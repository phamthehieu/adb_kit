import { useEffect, useState } from 'react'
import { BellRing, Loader2, Plus, Smartphone, Trash2 } from 'lucide-react'
import type { PushExtra, PushInfo, PushResult, PushTap } from '@shared/push'
import { PackagePicker } from './PackagePicker'

interface Saved {
  title: string
  text: string
  style: 'default' | 'bigtext'
  tap: PushTap
  link: string
  extras: PushExtra[]
}
const DEFAULTS: Saved = { title: 'Khuyến mãi dành cho bạn', text: 'Giảm 50% cho đơn đầu tiên, bấm để xem ngay.', style: 'default', tap: 'app', link: '', extras: [] }
const load = (): Saved => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('pushForm') ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

const TAPS: { id: PushTap; label: string; hint: string }[] = [
  { id: 'app', label: 'Mở app', hint: 'Giống chạm vào thông báo FCM khi app đang ở nền: mở màn hình đầu kèm dữ liệu bên dưới.' },
  { id: 'link', label: 'Mở liên kết trong app', hint: 'Mở thẳng một màn hình qua deep link, ví dụ myapp://order/123.' },
  { id: 'none', label: 'Không làm gì', hint: 'Chỉ để xem thông báo hiển thị ra sao (tiêu đề, nội dung dài, biểu tượng).' }
]

/**
 * "Thông báo": post a real notification from the phone itself and see what the app does when it is
 * tapped — no server, no Firebase key. (A message cannot be pushed INTO the app this way; the guide
 * on this panel says what to do for that.)
 */
export function PushPanel({ serial }: { serial: string }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('pushPkg') ?? localStorage.getItem('netPkg') ?? '')
  const [form, setForm] = useState<Saved>(load)
  const [info, setInfo] = useState<PushInfo | null>(null)
  const [busy, setBusy] = useState<'post' | 'open' | null>(null)
  const [res, setRes] = useState<PushResult | null>(null)

  useEffect(() => localStorage.setItem('pushForm', JSON.stringify(form)), [form])
  useEffect(() => {
    if (pkg) localStorage.setItem('pushPkg', pkg)
    setInfo(null)
    if (!pkg) return
    let live = true
    window.api.push.info(serial, pkg).then((i) => live && setInfo(i)).catch(() => {})
    return () => {
      live = false
    }
  }, [pkg, serial])

  const set = (p: Partial<Saved>): void => setForm((f) => ({ ...f, ...p }))
  const setExtra = (i: number, p: Partial<PushExtra>): void => set({ extras: form.extras.map((e, k) => (k === i ? { ...e, ...p } : e)) })

  const run = async (what: 'post' | 'open'): Promise<void> => {
    setBusy(what)
    setRes(null)
    try {
      const input = { pkg, ...form }
      setRes(await (what === 'post' ? window.api.push.post(serial, input) : window.api.push.open(serial, { ...input, tap: form.tap === 'link' ? 'link' : 'app' })))
    } catch (e) {
      setRes({ ok: false, message: window.api.push ? (e as Error).message : 'Cửa sổ này đang chạy phần cũ của ADB Kit. Hãy đóng hẳn ADB Kit rồi mở lại.' })
    } finally {
      setBusy(null)
    }
  }

  const needApp = form.tap !== 'none' && !pkg
  return (
    <div className="panel wide pu-panel">
      <div className="log-tools">
        <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="App nhận thông báo…" style={{ width: 280 }} />
        {info && (
          <>
            <span className={`devchip ${info.fcm ? '' : 'dim'}`} title="App có đăng ký nhận push của Firebase (FCM) hay không">{info.fcm ? 'App dùng FCM' : 'Không thấy FCM'}</span>
            {info.postPermission && <span className={`devchip ${info.postPermission === 'granted' ? '' : 'warn'}`}>Quyền thông báo: {info.postPermission === 'granted' ? 'đã cấp' : 'chưa cấp'}</span>}
          </>
        )}
      </div>

      <div className="panel-body pu-body">
        <section className="mini-sec">
          <div className="mini-head"><b>1. Nội dung thông báo</b></div>
          <label className="pu-row">
            <span>Tiêu đề</span>
            <input className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="pu-row">
            <span>Nội dung</span>
            <textarea className="input" rows={form.style === 'bigtext' ? 4 : 2} value={form.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <label className="pu-row">
            <span>Kiểu hiển thị</span>
            <select className="input sm" value={form.style} onChange={(e) => set({ style: e.target.value as Saved['style'] })}>
              <option value="default">Thường (một dòng, cắt bớt)</option>
              <option value="bigtext">Chữ dài (mở rộng được)</option>
            </select>
          </label>
        </section>

        <section className="mini-sec">
          <div className="mini-head"><b>2. Khi người dùng chạm vào thông báo</b></div>
          <div className="pu-taps" role="radiogroup" aria-label="Khi chạm vào thông báo">
            {TAPS.map((t) => (
              <button key={t.id} role="radio" aria-checked={form.tap === t.id} className={`pu-tap ${form.tap === t.id ? 'on' : ''}`} onClick={() => set({ tap: t.id })}>
                <b>{t.label}</b>
                <span>{t.hint}</span>
              </button>
            ))}
          </div>
          {form.tap === 'link' && (
            <label className="pu-row">
              <span>Liên kết</span>
              <input className="input" value={form.link} placeholder="myapp://order/123" onChange={(e) => set({ link: e.target.value })} spellCheck={false} />
            </label>
          )}
          {form.tap !== 'none' && (
            <div className="pu-extras">
              <div className="pu-extras-h">
                <b>Dữ liệu đính kèm</b>
                <span className="muted">giống phần “data” của tin push (khóa = giá trị, không dùng dấu cách)</span>
                <button className="iconbtn" onClick={() => set({ extras: [...form.extras, { key: '', value: '' }] })}>
                  <Plus size={13} /> Thêm
                </button>
              </div>
              {form.extras.map((e, i) => (
                <div key={i} className="pu-extra">
                  <input className="input sm" value={e.key} placeholder="khóa (vd. orderId)" aria-label="Khóa" onChange={(ev) => setExtra(i, { key: ev.target.value })} spellCheck={false} />
                  <span>=</span>
                  <input className="input sm" value={e.value} placeholder="giá trị (vd. 123)" aria-label="Giá trị" onChange={(ev) => setExtra(i, { value: ev.target.value })} spellCheck={false} />
                  <button className="iconbtn ghost danger" aria-label="Xóa dòng" onClick={() => set({ extras: form.extras.filter((_, k) => k !== i) })}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mini-sec">
          <div className="mini-head"><b>3. Thử</b></div>
          <div className="pu-actions">
            <button className="iconbtn primary" disabled={!!busy || needApp} onClick={() => void run('post')}>
              {busy === 'post' ? <Loader2 size={13} className="spin" /> : <BellRing size={13} />} Đăng thông báo lên điện thoại
            </button>
            <button className="iconbtn" disabled={!!busy || !pkg || form.tap === 'none'} onClick={() => void run('open')} title="Bỏ qua thông báo, mở app đúng như khi chạm vào nó">
              {busy === 'open' ? <Loader2 size={13} className="spin" /> : <Smartphone size={13} />} Chỉ mô phỏng lúc chạm
            </button>
          </div>
          {needApp && <div className="sx-need">Chọn app ở phía trên để thông báo biết mở app nào.</div>}
          {res && <div className={`sx-res ${res.ok ? 'ok' : 'bad'}`}>{res.message}</div>}
        </section>

        <details className="pu-note">
          <summary>Muốn thử đúng tin push FCM gửi vào app?</summary>
          <p>
            Android không cho công cụ trên máy tính “bắn” tin FCM thẳng vào app (chỉ Google Play Services được gửi). Cách nhanh nhất khi chưa có BE:
          </p>
          <ol>
            <li>Lấy mã đăng ký (FCM token) của máy: nhờ dev in ra log, rồi xem ở tab <b>Logcat</b>.</li>
            <li>Vào Firebase Console → Messaging → <b>Send test message</b>, dán token và gửi.</li>
          </ol>
          <p>Phần ở trên vẫn kiểm tra được phần hay hỏng nhất: <b>chạm vào thông báo</b> thì app mở đúng màn hình, đúng dữ liệu, kể cả khi app đã bị tắt hẳn (hãy dùng tab Độ bền để giết app trước).</p>
        </details>
      </div>
    </div>
  )
}
