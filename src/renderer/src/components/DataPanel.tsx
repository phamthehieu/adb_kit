import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, FileCode2, KeyRound, Loader2, MessageSquareText, Play, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import type { DataFile, DbResult, DbTable, MmkvEntry, PrefEntry } from '@shared/appdata'
import type { OtpHit } from '../../../preload'
import { setClipboard } from '../lib/control'
import { PackagePicker } from './PackagePicker'

/* ------------------------------------------------------------ typing */

/**
 * Type on the phone: ASCII with `adb input text` (works with or without the mirror);
 * accented / other text is pasted through the mirror's clipboard.
 */
async function typeOnPhone(serial: string, t: string): Promise<void> {
  if (/^[\x20-\x7e]*$/.test(t)) await window.api.typeText(serial, t)
  else window.api.mirror.control(setClipboard(t, true))
}

/* ------------------------------------------------------------ OTP + accounts */

interface Account {
  label: string
  user: string
  password: string
  note: string
}

const loadAccounts = (): Account[] => {
  try {
    return JSON.parse(localStorage.getItem('testAccounts') ?? '[]') as Account[]
  } catch {
    return []
  }
}

function OtpTab({ serial }: { serial: string }) {
  const [watching, setWatching] = useState(false)
  const [hits, setHits] = useState<OtpHit[]>([])
  const [auto, setAuto] = useState(() => localStorage.getItem('otpAuto') === '1')
  const [msg, setMsg] = useState('')
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts)
  const [form, setForm] = useState<Account>({ label: '', user: '', password: '', note: '' })
  const autoRef = useRef(auto)
  autoRef.current = auto

  useEffect(() => {
    if (!watching) return
    let alive = true
    void window.api.otp.start(serial)
    const t = setInterval(async () => {
      const h = await window.api.otp.poll(serial).catch(() => [] as OtpHit[])
      if (!alive || !h.length) return
      setHits((l) => [...h.reverse(), ...l].slice(0, 20))
      if (autoRef.current) {
        await typeOnPhone(serial, h[0].code)
        setMsg(`Đã tự điền mã ${h[0].code}`)
      }
    }, 2000)
    return () => {
      alive = false
      clearInterval(t)
      void window.api.otp.stop(serial)
    }
  }, [watching, serial])

  const saveAccounts = (l: Account[]): void => {
    setAccounts(l)
    localStorage.setItem('testAccounts', JSON.stringify(l))
  }
  const fill = async (t: string, what: string): Promise<void> => {
    await typeOnPhone(serial, t)
    setMsg(`Đã điền ${what} — nhớ chạm vào ô cần nhập trên điện thoại trước`)
  }

  return (
    <div className="dt-body">
      <section className="mini-sec">
        <div className="mini-head">
          <MessageSquareText size={14} />
          <b>Mã OTP</b>
          <span className="muted">đọc từ thông báo trên điện thoại (SMS, app xác thực…) — chỉ lấy mã số, không lưu nội dung tin nhắn</span>
          <span className="spacer" />
          <label className="mini-check" title="Có mã mới là tự gõ vào ô đang chọn trên điện thoại">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked)
                localStorage.setItem('otpAuto', e.target.checked ? '1' : '0')
              }}
            />{' '}
            Tự điền
          </label>
          <button className={`iconbtn ${watching ? 'on' : 'primary'}`} onClick={() => setWatching(!watching)}>
            {watching ? <Loader2 size={12} className="spin" /> : <Play size={12} />} {watching ? 'Đang chờ mã… (bấm để dừng)' : 'Chờ mã OTP'}
          </button>
        </div>
        {!watching && !hits.length && (
          <div className="steps-empty">
            Bấm <b>Chờ mã OTP</b> trước khi bấm "Gửi mã" trong app. Mã mới đến (thông báo đã có từ trước bị bỏ qua) sẽ hiện ở đây — bấm <b>Điền</b> để gõ vào
            ô đang chọn, hoặc bật <b>Tự điền</b>. Trong kịch bản tự động dùng bước "Chờ mã OTP rồi điền".
          </div>
        )}
        {hits.map((h, i) => (
          <div key={`${h.seenAt}-${i}`} className={`otp-row ${i === 0 ? 'new' : ''}`}>
            <span className="otp-code mono">{h.code}</span>
            <span className="muted">
              {h.title || h.pkg} · {new Date(h.seenAt).toLocaleTimeString('vi-VN')}
            </span>
            <span className="spacer" />
            <button className="iconbtn" onClick={() => void fill(h.code, `mã ${h.code}`)}>Điền</button>
            <button className="iconbtn ghost" onClick={() => void navigator.clipboard.writeText(h.code)}>Sao chép</button>
          </div>
        ))}
      </section>

      <section className="mini-sec">
        <div className="mini-head">
          <KeyRound size={14} />
          <b>Tài khoản test</b>
          <span className="muted">lưu trên máy tính này — một chạm là điền vào ô đang chọn</span>
        </div>
        {accounts.map((a, i) => (
          <div key={i} className="acc-row">
            <div className="acc-t">
              <b>{a.label || a.user}</b>
              <span className="muted">
                {a.user}
                {a.note ? ` · ${a.note}` : ''}
              </span>
            </div>
            <button className="iconbtn" onClick={() => void fill(a.user, 'tài khoản')}>Điền tài khoản</button>
            {a.password && (
              <button className="iconbtn" onClick={() => void fill(a.password, 'mật khẩu')}>Điền mật khẩu</button>
            )}
            <button className="iconbtn ghost" title="Xóa" onClick={() => confirm(`Xóa "${a.label || a.user}"?`) && saveAccounts(accounts.filter((_, k) => k !== i))}>
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="acc-form">
          <input className="input" placeholder="Tên gợi nhớ (vd. Thuê bao trả trước)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input className="input" placeholder="Số điện thoại / tài khoản" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
          <input className="input" type="password" placeholder="Mật khẩu (tùy chọn)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <input className="input" placeholder="Ghi chú (môi trường, gói cước…)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button
            className="iconbtn"
            disabled={!form.user.trim()}
            onClick={() => {
              saveAccounts([...accounts, { ...form, user: form.user.trim() }])
              setForm({ label: '', user: '', password: '', note: '' })
            }}
          >
            <Plus size={12} /> Thêm
          </button>
        </div>
        <div className="muted dt-note">Chỉ dùng tài khoản test. Mật khẩu lưu dạng thường trong dữ liệu của ADB Kit trên máy tính này.</div>
      </section>
      {msg && <div className="ck-note">{msg}</div>}
    </div>
  )
}

/* ------------------------------------------------------------ App data */

const fmtSize = (n: number): string => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
const KIND_LABEL: Record<DataFile['kind'], string> = { prefs: 'SharedPreferences', db: 'Database (SQLite)', mmkv: 'MMKV', other: 'Khác' }

function AppDataTab({ serial }: { serial: string }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('dataPkg') ?? localStorage.getItem('netPkg') ?? '')
  const [files, setFiles] = useState<DataFile[] | null>(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<DataFile | null>(null)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!pkg) return
    localStorage.setItem('dataPkg', pkg)
    setLoading(true)
    setErr('')
    try {
      setFiles(await window.api.data.list(serial, pkg))
    } catch (e) {
      setFiles(null)
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [serial, pkg])
  useEffect(() => {
    setSel(null)
    void load()
  }, [load])

  const shown = (files ?? []).filter((f) => !filter.trim() || f.path.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="dt-split">
      <div className="dt-files">
        <div className="dt-files-top">
          <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="App (bản debug)…" />
          <div className="dt-files-row">
            <input className="input" placeholder="Lọc file…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="iconbtn" disabled={!pkg || loading} onClick={() => void load()} title="Đọc lại">
              {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            </button>
          </div>
        </div>
        {err && <div className="steps-empty bad">{err}</div>}
        {!pkg && <div className="steps-empty">Chọn app (bản debug) để xem dữ liệu riêng của nó.</div>}
        {(['prefs', 'db', 'mmkv', 'other'] as const).map((k) => {
          const list = shown.filter((f) => f.kind === k)
          if (!list.length) return null
          return (
            <div key={k}>
              <div className="help-group-h">
                {KIND_LABEL[k]} ({list.length})
              </div>
              {list.map((f) => (
                <button key={f.path} className={`dt-file ${sel?.path === f.path ? 'on' : ''}`} onClick={() => setSel(f)} title={f.path}>
                  <span>{f.path.split('/').pop()}</span>
                  <span className="muted">{fmtSize(f.size)}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div className="dt-view">
        {!sel && <div className="steps-empty">Chọn một file bên trái. SharedPreferences sửa được (app sẽ được đóng khi lưu); database và MMKV chỉ xem.</div>}
        {sel?.kind === 'prefs' && <PrefsView key={sel.path} serial={serial} pkg={pkg} file={sel} />}
        {sel?.kind === 'db' && <DbView key={sel.path} serial={serial} pkg={pkg} file={sel} />}
        {sel?.kind === 'mmkv' && <MmkvView key={sel.path} serial={serial} pkg={pkg} file={sel} />}
        {sel?.kind === 'other' && <div className="steps-empty">Chưa xem được loại file này.</div>}
      </div>
    </div>
  )
}

function PrefsView({ serial, pkg, file }: { serial: string; pkg: string; file: DataFile }) {
  const [rows, setRows] = useState<PrefEntry[] | null>(null)
  const [orig, setOrig] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await window.api.data.prefs(serial, pkg, file.path)
      setRows(r)
      setOrig(JSON.stringify(r))
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [serial, pkg, file.path])
  useEffect(() => void load(), [load])

  const dirty = rows !== null && JSON.stringify(rows) !== orig
  const upd = (i: number, p: Partial<PrefEntry>): void => setRows((r) => r!.map((x, k) => (k === i ? { ...x, ...p } : x)))
  const save = async (): Promise<void> => {
    if (!rows || !confirm(`Lưu ${file.path.split('/').pop()}?\n\nApp ${pkg} sẽ bị đóng để ghi file (app đang chạy sẽ ghi đè lên thay đổi).`)) return
    setSaving(true)
    setErr('')
    try {
      await window.api.data.savePrefs(serial, pkg, file.path, rows)
      setOrig(JSON.stringify(rows))
      setMsg('Đã lưu và đóng app — mở lại app để áp dụng')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dt-pane">
      <div className="dt-pane-head">
        <FileCode2 size={14} />
        <b title={file.path}>{file.path}</b>
        <span className="muted">{rows ? `${rows.length} khóa` : ''}</span>
        <span className="spacer" />
        <input className="input" placeholder="Lọc khóa / giá trị…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 170 }} />
        <button className="iconbtn" onClick={() => void load()} title="Đọc lại"><RefreshCw size={12} /></button>
        <button className="iconbtn" onClick={() => setRows((r) => [...(r ?? []), { type: 'string', name: '', value: '' }])}><Plus size={12} /> Thêm khóa</button>
        <button className="iconbtn primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />} Lưu (đóng app)
        </button>
      </div>
      {err && <div className="ck-note bad">{err}</div>}
      {msg && !dirty && <div className="ck-note">{msg}</div>}
      {rows && (
        <table className="mini-table dt-table">
          <thead>
            <tr>
              <th>Khóa</th>
              <th>Kiểu</th>
              <th>Giá trị</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) =>
              q && !`${r.name} ${r.value}`.toLowerCase().includes(q.toLowerCase()) ? null : (
                <tr key={i}>
                  <td>
                    <input className="input mono" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <select className="input" value={r.type} onChange={(e) => upd(i, { type: e.target.value as PrefEntry['type'] })}>
                      {['string', 'boolean', 'int', 'long', 'float', 'set'].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="dt-val">
                    {r.type === 'boolean' ? (
                      <select className="input" value={r.value} onChange={(e) => upd(i, { value: e.target.value })}>
                        <option>true</option>
                        <option>false</option>
                      </select>
                    ) : r.type === 'set' || r.value.length > 80 || r.value.includes('\n') ? (
                      <textarea className="input mono" rows={Math.min(6, Math.max(2, r.value.split('\n').length))} value={r.value} onChange={(e) => upd(i, { value: e.target.value })} />
                    ) : (
                      <input className="input mono" value={r.value} onChange={(e) => upd(i, { value: e.target.value })} />
                    )}
                  </td>
                  <td>
                    <button className="iconbtn ghost" title="Xóa khóa" onClick={() => setRows((rr) => rr!.filter((_, k) => k !== i))}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

function DbView({ serial, pkg, file }: { serial: string; pkg: string; file: DataFile }) {
  const [tables, setTables] = useState<DbTable[] | null>(null)
  const [sql, setSql] = useState('')
  const [res, setRes] = useState<DbResult | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (s: string) => {
      setBusy(true)
      setErr('')
      try {
        setRes(await window.api.data.query(serial, pkg, file.path, s))
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [serial, pkg, file.path]
  )
  const refresh = useCallback(async () => {
    setErr('')
    setBusy(true)
    try {
      const t = await window.api.data.tables(serial, pkg, file.path)
      setTables(t)
      if (t[0] && !sql) {
        const s = `SELECT * FROM "${t[0].name}" LIMIT 200`
        setSql(s)
        await run(s)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [serial, pkg, file.path]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void refresh(), [refresh])

  const pick = (name: string): void => {
    const s = `SELECT * FROM "${name}" LIMIT 200`
    setSql(s)
    void run(s)
  }

  return (
    <div className="dt-pane">
      <div className="dt-pane-head">
        <Database size={14} />
        <b title={file.path}>{file.path}</b>
        <span className="muted">bản sao chỉ đọc</span>
        <span className="spacer" />
        <button className="iconbtn" onClick={() => void refresh()} title="Chép lại database mới nhất từ máy"><RefreshCw size={12} /> Đọc lại</button>
      </div>
      {tables && (
        <div className="ck-sum">
          {tables.map((t) => (
            <button key={t.name} className="fg-chip" onClick={() => pick(t.name)}>
              {t.name} <b>{t.rows >= 0 ? t.rows : '?'}</b>
            </button>
          ))}
        </div>
      )}
      <div className="dt-sql">
        <textarea
          className="input mono"
          rows={2}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void run(sql)}
          placeholder='SELECT * FROM "bang" WHERE … LIMIT 200'
        />
        <button className="iconbtn primary" disabled={busy || !sql.trim()} onClick={() => void run(sql)} title="Ctrl + Enter">
          {busy ? <Loader2 size={12} className="spin" /> : <Play size={12} />} Chạy
        </button>
      </div>
      {err && <div className="ck-note bad">{err}</div>}
      {res && (
        <div className="dt-grid">
          <table className="mini-table">
            <thead>
              <tr>
                {res.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {res.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, k) => (
                    <td key={k} className={`mono ${v === null ? 'muted' : ''}`} title={v === null ? 'NULL' : String(v)}>
                      {v === null ? 'NULL' : String(v).slice(0, 200)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted dt-note">
            {res.rows.length} dòng{res.truncated ? ' (giới hạn 500 dòng)' : ''} · chỉ chạy câu SELECT / WITH / PRAGMA
          </div>
        </div>
      )}
    </div>
  )
}

function MmkvView({ serial, pkg, file }: { serial: string; pkg: string; file: DataFile }) {
  const [rows, setRows] = useState<MmkvEntry[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    void window.api.data
      .mmkv(serial, pkg, file.path)
      .then(setRows)
      .catch((e) => setErr((e as Error).message))
  }, [serial, pkg, file.path])
  return (
    <div className="dt-pane">
      <div className="dt-pane-head">
        <Database size={14} />
        <b>{file.path}</b>
        <span className="muted">MMKV · chỉ xem (kiểu giá trị là đoán)</span>
        <span className="spacer" />
        <input className="input" placeholder="Lọc…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 170 }} />
      </div>
      {err && <div className="ck-note bad">{err}</div>}
      {rows && (
        <table className="mini-table dt-table">
          <thead>
            <tr>
              <th>Khóa</th>
              <th>Giá trị</th>
              <th>Đọc như</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => !q || `${r.key} ${r.value}`.toLowerCase().includes(q.toLowerCase()))
              .map((r) => (
                <tr key={r.key}>
                  <td className="mono">{r.key}</td>
                  <td className="mono dt-val" title={r.value}>{r.value.slice(0, 300)}</td>
                  <td className="muted">{r.as}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ panel */

export function DataPanel({ serial }: { serial: string }) {
  const [tab, setTab] = useState<'otp' | 'app'>(() => (localStorage.getItem('dataTab') as 'otp' | 'app') || 'otp')
  const pick = (t: 'otp' | 'app'): void => {
    setTab(t)
    localStorage.setItem('dataTab', t)
  }
  return (
    <div className="panel wide dt-panel">
      <div className="panel-head">
        <div className="seg">
          <button className={tab === 'otp' ? 'on' : ''} onClick={() => pick('otp')}>OTP &amp; tài khoản test</button>
          <button className={tab === 'app' ? 'on' : ''} onClick={() => pick('app')}>Dữ liệu app</button>
        </div>
      </div>
      {tab === 'otp' ? <OtpTab serial={serial} /> : <AppDataTab serial={serial} />}
    </div>
  )
}
