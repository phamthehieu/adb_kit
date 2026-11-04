import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Pencil, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import type { AppStateMeta } from '@shared/appstate'
import { PackagePicker } from './PackagePicker'
import { ask } from '../lib/dialog'

/** Fields of the "Khôi phục trạng thái app" step in a script: app, which saved state, open afterwards. */
export function StateStepFields({
  serial,
  pkg,
  name,
  launch,
  onChange
}: {
  serial: string
  pkg: string
  name: string
  launch: boolean
  onChange: (patch: { pkg?: string; name?: string; launch?: boolean }) => void
}) {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    void window.api.appState.list(pkg || undefined).then((l) => alive && setNames([...new Set(l.map((m) => m.name))]))
    return () => {
      alive = false
    }
  }, [pkg])
  const stop = (e: React.MouseEvent): void => e.stopPropagation()
  return (
    <>
      <PackagePicker serial={serial} className="sm grow" value={pkg} placeholder="package" onChange={(p) => onChange({ pkg: p })} />
      <select className="input sm" value={name} onClick={stop} onChange={(e) => onChange({ name: e.target.value })} aria-label="Trạng thái đã lưu" style={{ width: 200 }}>
        <option value="">— chọn trạng thái đã lưu —</option>
        {name && !names.includes(name) && <option value={name}>{name} (chưa có trên máy này)</option>}
        {names.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <label className="check" onClick={stop} title="Mở app ngay sau khi khôi phục">
        <input type="checkbox" checked={launch} onChange={(e) => onChange({ launch: e.target.checked })} /> mở app
      </label>
    </>
  )
}

const when = (ms: number): string => new Date(ms).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
const kb = (n: number): string => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/**
 * "Trạng thái app": save the private data of a debuggable app (login, settings, local databases)
 * under a name and put it back in seconds — "đăng nhập tài khoản A" / "tài khoản B" / "mới cài" —
 * instead of logging in again before every test. Also usable as a step in automated scripts.
 */
export function AppStateTab({ serial }: { serial: string }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('statePkg') ?? localStorage.getItem('dataPkg') ?? localStorage.getItem('netPkg') ?? '')
  const [list, setList] = useState<AppStateMeta[]>([])
  const [onlyPkg, setOnlyPkg] = useState(() => localStorage.getItem('stateOnlyPkg') !== '0')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; warn?: string } | null>(null)
  const [launch, setLaunch] = useState(true)
  const [editing, setEditing] = useState<{ id: string; name: string; note: string } | null>(null)
  const [usage, setUsage] = useState(0)

  const refresh = useCallback(async () => {
    setList(await window.api.appState.list())
    setUsage(await window.api.appState.usage())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (pkg) localStorage.setItem('statePkg', pkg)
  }, [pkg])

  const run = async (key: string, fn: () => Promise<{ text: string; warn?: string } | void>): Promise<void> => {
    setBusy(key)
    setMsg(null)
    try {
      const r = await fn()
      if (r) setMsg({ text: r.text, warn: r.warn })
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const save = (): Promise<void> =>
    run('save', async () => {
      const r = await window.api.appState.save(serial, pkg, name, note)
      setName('')
      setNote('')
      return { text: r.message }
    })

  const restore = async (m: AppStateMeta): Promise<void> => {
    const ok = await ask(`Khôi phục "${m.name}" cho ${m.pkg}?\n\nDữ liệu hiện tại của app trên điện thoại sẽ bị thay bằng bản đã lưu (đăng nhập, cài đặt, cơ sở dữ liệu). Nếu muốn giữ, hãy lưu trạng thái hiện tại trước.`, {
      title: 'Khôi phục trạng thái app',
      danger: true,
      ok: 'Khôi phục'
    })
    if (!ok) return
    await run(`r-${m.id}`, async () => {
      const r = await window.api.appState.restore(serial, m.id, launch)
      return { text: r.message, warn: r.versionWarning }
    })
  }

  const remove = async (m: AppStateMeta): Promise<void> => {
    if (!(await ask(`Xóa trạng thái "${m.name}"?\n\nChỉ xóa bản đã lưu trên máy tính này, không ảnh hưởng điện thoại.`, { danger: true, ok: 'Xóa' }))) return
    await run(`d-${m.id}`, () => window.api.appState.remove(m.id))
  }

  const shown = list.filter((m) => !onlyPkg || !pkg || m.pkg === pkg)

  return (
    <div className="dt-body">
      <section className="mini-sec">
        <div className="mini-head">
          <Save size={15} />
          <b>Lưu trạng thái hiện tại</b>
          <span className="muted">chép dữ liệu riêng của app (đăng nhập, cài đặt, cơ sở dữ liệu) về máy tính</span>
        </div>
        <div className="st-form">
          <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="App (bản debug)…" />
          <input className="input" placeholder="Tên, ví dụ: Tài khoản A – đã đăng nhập" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pkg && name.trim() && void save()} />
          <input className="input" placeholder="Ghi chú (tùy chọn)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="iconbtn primary" disabled={!pkg || !name.trim() || !!busy} onClick={() => void save()} title="App sẽ được tắt hẳn trong lúc chép để dữ liệu đầy đủ">
            {busy === 'save' ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Lưu trạng thái
          </button>
        </div>
        <div className="st-hint">
          Chỉ dùng được với app <b>bản debug</b>. Bộ nhớ đệm (cache) không được lưu nên bản lưu nhẹ và khôi phục nhanh. Bản lưu chứa <b>token đăng nhập</b>: chỉ nằm trên máy này, đừng gửi cho người ngoài.
        </div>
      </section>

      {msg && (
        <div className={`st-msg ${msg.bad ? 'bad' : 'ok'}`}>
          {msg.text}
          {msg.warn && <div className="st-warn">⚠ {msg.warn}</div>}
        </div>
      )}

      <section className="mini-sec">
        <div className="mini-head">
          <RotateCcw size={15} />
          <b>Đã lưu</b>
          <span className="muted">
            {shown.length} trạng thái · {kb(usage)} trên máy tính
          </span>
          <span className="spacer" />
          <label className="check" title="Chỉ hiện trạng thái của app đang chọn ở trên">
            <input
              type="checkbox"
              checked={onlyPkg}
              onChange={(e) => {
                setOnlyPkg(e.target.checked)
                localStorage.setItem('stateOnlyPkg', e.target.checked ? '1' : '0')
              }}
            />{' '}
            Chỉ app đang chọn
          </label>
          <label className="check" title="Sau khi khôi phục, mở app ngay">
            <input type="checkbox" checked={launch} onChange={(e) => setLaunch(e.target.checked)} /> Mở app sau khi khôi phục
          </label>
          <button
            className="iconbtn sm-btn"
            onClick={() =>
              void run('import', async () => {
                const m = await window.api.appState.import()
                return m ? { text: `Đã nhập "${m.name}" (${m.files} tệp)` } : undefined
              })
            }
            title="Nhập file .adbstate đồng nghiệp gửi"
          >
            <Upload size={12} /> Nhập từ file
          </button>
        </div>

        {shown.length === 0 && (
          <div className="steps-empty">
            {list.length ? 'Chưa có trạng thái nào cho app này.' : 'Chưa lưu trạng thái nào. Đăng nhập vào app như bình thường, rồi đặt tên và bấm “Lưu trạng thái”.'}
          </div>
        )}
        <div className="st-list">
          {shown.map((m) => (
            <div key={m.id} className="st-row">
              <div className="st-main">
                {editing?.id === m.id ? (
                  <div className="st-edit">
                    <input className="input" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    <input className="input" placeholder="Ghi chú" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
                    <button
                      className="iconbtn primary sm-btn"
                      onClick={() =>
                        void run('rename', async () => {
                          await window.api.appState.rename(m.id, editing.name, editing.note)
                          setEditing(null)
                        })
                      }
                    >
                      Lưu
                    </button>
                    <button className="iconbtn sm-btn" onClick={() => setEditing(null)}>Hủy</button>
                  </div>
                ) : (
                  <>
                    <div className="st-name">{m.name}</div>
                    {m.note && <div className="st-note">{m.note}</div>}
                    <div className="st-meta">
                      <span className="mono">{m.pkg}</span> · {when(m.createdAt)} · {m.files} tệp, {kb(m.size)}
                      {m.appVersion ? ` · bản ${m.appVersion}` : ''} · {m.device}
                    </div>
                  </>
                )}
              </div>
              <div className="st-acts">
                <button className="iconbtn primary sm-btn" disabled={!!busy} onClick={() => void restore(m)} title="Đưa dữ liệu app trên điện thoại về đúng trạng thái này">
                  {busy === `r-${m.id}` ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />} Khôi phục
                </button>
                <button className="iconbtn ghost sm-btn" title="Đổi tên / ghi chú" aria-label="Đổi tên" onClick={() => setEditing({ id: m.id, name: m.name, note: m.note })}>
                  <Pencil size={12} />
                </button>
                <button
                  className="iconbtn ghost sm-btn"
                  title="Xuất ra file .adbstate để gửi đồng nghiệp"
                  aria-label="Xuất"
                  onClick={() =>
                    void run('export', async () => {
                      const p = await window.api.appState.export(m.id)
                      return p ? { text: `Đã xuất ra ${p}` } : undefined
                    })
                  }
                >
                  <Download size={12} />
                </button>
                <button className="iconbtn ghost sm-btn danger" title="Xóa bản đã lưu" aria-label="Xóa" onClick={() => void remove(m)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="st-hint">
          Dùng trong test tự động: tab <b>Tự động test</b> › <b>Thêm bước</b> › <b>Khôi phục trạng thái app</b> — mỗi testcase bắt đầu từ đúng tài khoản mà không phải đăng nhập lại.
        </div>
      </section>
    </div>
  )
}
