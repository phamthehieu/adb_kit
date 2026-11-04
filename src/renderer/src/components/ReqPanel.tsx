import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckSquare, FileSpreadsheet, FileText, Loader2, PenLine, ScanSearch, Square, Trash2, Upload, X } from 'lucide-react'
import {
  casesOf,
  fieldWarnings,
  matchScreens,
  probesOf,
  ruleLabel,
  shortApi,
  type Probe,
  type ReqCase,
  type ReqDoc,
  type ReqDocInfo,
  type ReqField,
  type ScreenMatch,
  type ScreenScan
} from '@shared/reqdoc'
import { setClipboard } from '../lib/control'
import { conformIssues } from '@shared/reqapi'
import { ApiLive, CaptureBar, reportFor, useCapture, type Capture } from './ReqApiLive'
import { PaneHandle } from './PaneHandle'
import { ask } from '../lib/dialog'

/**
 * BA requirement documents (TLNV / MTYCTD .docx): what each screen / API must do, test cases
 * generated from it (→ KBKT), and a check of the phone's current screen against the document.
 */

type Tab = 'screens' | 'apis' | 'cases' | 'check'

const yn = (v: boolean | null): string => (v === true ? 'Có' : v === false ? 'Không' : '–')

/* ------------------------------------------------------------ fill test values */

function useFill(serial: string): { fill: (p: Probe, f: ReqField) => Promise<void>; msg: string } {
  const [msg, setMsg] = useState('')
  const fill = async (p: Probe, f: ReqField): Promise<void> => {
    setMsg('Đang điền…')
    try {
      setMsg(await window.api.req.fill(serial, p.value, f.title))
    } catch (e) {
      // Accented text and no WebView input found: paste through the mirror's clipboard.
      if (/[^\x20-\x7e]/.test(p.value)) {
        window.api.mirror.control(setClipboard(p.value, true))
        setMsg('Đã dán qua clipboard vào ô đang chọn (cần đang mở màn hình phản chiếu)')
      } else setMsg((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return { fill, msg }
}

function Probes({ field, onFill }: { field: ReqField; onFill: (p: Probe, f: ReqField) => void }) {
  const probes = probesOf(field)
  if (!probes.length) return null
  return (
    <div className="rq-probes">
      {probes.map((p) => (
        <button key={p.label} className={`rq-probe ${p.expect}`} onClick={() => onFill(p, field)} title={`Điền: ${p.value.length > 80 ? `${p.value.slice(0, 80)}… (${p.value.length} ký tự)` : p.value}\nTài liệu: ${p.expect === 'ok' ? 'phải chấp nhận' : 'phải chặn / báo lỗi'}`}>
          {p.expect === 'ok' ? <Check size={11} /> : <X size={11} />}
          {p.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ screens */

function DocImage({ id, name }: { id: string; name: string }) {
  const [src, setSrc] = useState('')
  const [big, setBig] = useState(false)
  useEffect(() => {
    let alive = true
    window.api.req.image(id, name).then((s) => alive && setSrc(s)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [id, name])
  if (!src) return <div className="rq-img empty" />
  return (
    <>
      <img className="rq-img" src={src} alt="" onClick={() => setBig(true)} title="Ảnh trong tài liệu – bấm để phóng to" />
      {big && (
        <div className="rq-lightbox" onClick={() => setBig(false)}>
          <img src={src} alt="" />
        </div>
      )}
    </>
  )
}

function ScreensTab({ doc, serial }: { doc: ReqDoc; serial: string }) {
  const [sel, setSel] = useState(doc.screens[0]?.id ?? '')
  const [open, setOpen] = useState<string | null>(null)
  const { fill, msg } = useFill(serial)
  const s = doc.screens.find((x) => x.id === sel) ?? doc.screens[0]
  if (!s) return <div className="rq-empty muted">Tài liệu không có bảng mô tả màn hình.</div>
  let section: string | undefined
  return (
    <div className="rq-split">
      <div className="rq-list">
        {doc.screens.map((x) => {
          const warn = x.fields.reduce((n, f) => n + fieldWarnings(f).length, 0)
          return (
            <button key={x.id} className={`rq-item ${x.id === s.id ? 'on' : ''}`} onClick={() => setSel(x.id)} title={x.path.filter(Boolean).join(' › ')}>
              <span className="t">{x.title}</span>
              <span className="muted">
                {x.fields.length} thành phần{x.flow.length ? ` · ${x.flow.length} xử lý` : ''}
                {warn ? <span className="rq-warn-n"> · {warn} cần hỏi BA</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      <PaneHandle id="rq-list" target="prev" />
      <div className="rq-detail">
        <div className="rq-crumb muted">{s.path.filter(Boolean).slice(0, -1).join(' › ')}</div>
        <h3 className="rq-h">{s.title}</h3>
        {s.images.length > 0 && (
          <div className="rq-imgs">
            {s.images.map((n) => (
              <DocImage key={n} id={doc.id} name={n} />
            ))}
          </div>
        )}
        {msg && <div className="rq-msg">{msg}</div>}
        {s.fields.length > 0 && (
          <table className="rq-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Thành phần</th>
                <th>Loại</th>
                <th>Sửa</th>
                <th>Bắt buộc</th>
                <th>Quy tắc</th>
              </tr>
            </thead>
            <tbody>
              {s.fields.map((f, i) => {
                const key = `${s.id}:${i}`
                const head = f.section && f.section !== section ? f.section : null
                section = f.section
                const warns = fieldWarnings(f)
                const probes = probesOf(f).length
                return [
                  head && (
                    <tr key={`${key}h`} className="rq-sec">
                      <td colSpan={6}>{head}</td>
                    </tr>
                  ),
                  <tr key={key} className={open === key ? 'on' : ''} onClick={() => setOpen(open === key ? null : key)}>
                    <td className="mono">{f.no}</td>
                    <td>
                      {f.title || <span className="muted">(không tên)</span>}
                      {warns.length > 0 && (
                        <span className="rq-warn" title={warns.join('\n')}>
                          <AlertTriangle size={11} />
                        </span>
                      )}
                    </td>
                    <td className="muted">{f.type}</td>
                    <td>{yn(f.editable)}</td>
                    <td>{yn(f.mandatory)}</td>
                    <td>
                      <div className="rq-rules">
                        {f.rules.filter((r) => r.kind !== 'api').map((r, k) => (
                          <span key={k} className={`rq-rule r-${r.kind}`}>{ruleLabel(r)}</span>
                        ))}
                        {probes > 0 && <span className="rq-rule fill"><PenLine size={10} /> {probes} giá trị thử</span>}
                      </div>
                    </td>
                  </tr>,
                  open === key && (
                    <tr key={`${key}d`} className="rq-more">
                      <td />
                      <td colSpan={5}>
                        {warns.map((w) => (
                          <div key={w} className="rq-warn-line"><AlertTriangle size={11} /> {w}</div>
                        ))}
                        <div className="rq-desc">{f.desc || <span className="muted">Không có mô tả</span>}</div>
                        {f.data && <div className="muted">Dữ liệu chuẩn bị: {f.data}</div>}
                        {probes > 0 && (
                          <>
                            <div className="muted rq-hint">Chạm vào ô trên điện thoại (hoặc để ADB Kit tự tìm ô có nhãn “{f.title}” trong miniapp) rồi bấm giá trị cần điền:</div>
                            <Probes field={f} onFill={(p) => void fill(p, f)} />
                          </>
                        )}
                      </td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
        )}
        {s.flow.length > 0 && (
          <div className="rq-flow">
            <b>Xử lý sự kiện</b>
            {s.flow.map((r, i) => (
              <div key={i} className="rq-flow-row">
                {r.section && (i === 0 || s.flow[i - 1].section !== r.section) && <div className="rq-flow-sec">{r.section}</div>}
                <div>{r.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ APIs */

function ApisTab({ doc, cap }: { doc: ReqDoc; cap: Capture }) {
  const [sel, setSel] = useState(doc.apis[0]?.id ?? '')
  const a = doc.apis.find((x) => x.id === sel) ?? doc.apis[0]
  if (!a) return <div className="rq-empty muted">Tài liệu không có phần đặc tả API.</div>
  return (
    <div className="rq-cases">
      <CaptureBar cap={cap} />
    <div className="rq-split">
      <div className="rq-list">
        {doc.apis.map((x) => {
          const r = cap.calls.length ? reportFor(doc, x, cap.calls) : null
          const bad = r?.sample ? conformIssues(r) : -1
          return (
            <button key={x.id} className={`rq-item ${x.id === a.id ? 'on' : ''}`} onClick={() => setSel(x.id)} title={x.name}>
              <span className="t">
                {shortApi(x.name)}
                {bad === 0 && <span className="rq-ok-n"> ✓</span>}
                {bad > 0 && <span className="rq-warn-n"> · {bad} lệch</span>}
              </span>
              <span className="muted">
                {[x.system, x.screen].filter(Boolean).join(' · ') || `${x.inputs.length} vào · ${x.outputs.length} ra`}
              </span>
            </button>
          )
        })}
      </div>
      <PaneHandle id="rq-list" target="prev" />
      <div className="rq-detail">
        <div className="rq-crumb muted">{[a.system, a.screen].filter(Boolean).join(' › ')}</div>
        <h3 className="rq-h">{a.name}</h3>
        {(a.method || a.url) && (
          <div className="rq-endpoint mono">
            <span className="rq-method">{a.method ?? '?'}</span> {a.url ?? <span className="muted">(tài liệu không ghi đường dẫn)</span>}
          </div>
        )}
        {a.purpose && <p className="rq-desc">{a.purpose}</p>}
        <ApiLive key={a.id} doc={doc} api={a} cap={cap} />
        {a.inputs.length > 0 && (
          <>
            <b className="rq-sub">Đầu vào ({a.inputs.filter((p) => p.required).length} bắt buộc)</b>
            <table className="rq-table">
              <tbody>
                {a.inputs.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.name}{p.required && <span className="rq-req">*</span>}</td>
                    <td className="muted">{p.type}</td>
                    <td className="rq-desc">{p.desc}{p.map ? <span className="muted"> → {p.map}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {(a.outputs.length > 0 || a.outputText) && <b className="rq-sub">Đầu ra</b>}
        {a.outputText && <div className="rq-desc">{a.outputText}</div>}
        {a.outputs.length > 0 && (
          <table className="rq-table">
            <tbody>
              {a.outputs.map((p, i) => (
                <tr key={i}>
                  <td className="mono">{p.name}</td>
                  <td className="muted">{p.type}</td>
                  <td className="rq-desc">{p.desc}{p.map ? <span className="muted"> → {p.map}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {a.steps.length > 0 && (
          <>
            <b className="rq-sub">Xử lý</b>
            {a.steps.map((s, i) => (
              <div key={i} className="rq-step">
                <div><b>Bước {s.no}.</b> {s.text}</div>
                {s.branches.map((b, k) => (
                  <div key={k} className="rq-branch">
                    <span className={`rq-cond ${/(không|lỗi|thất bại|false|nok|thiếu|sai)/i.test(b.cond) ? 'bad' : ''}`}>{b.cond}</span> → {b.action}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
        {a.codes.length > 0 && (
          <>
            <b className="rq-sub">Mã trả về</b>
            {a.codes.map((c, i) => (
              <div key={i} className="rq-branch"><span className="mono">{c.code}</span> {c.message}</div>
            ))}
          </>
        )}
      </div>
    </div>
    </div>
  )
}

/* ------------------------------------------------------------ test cases */

const KIND_LABEL: Record<ReqCase['kind'], string> = { ui: 'Giao diện', field: 'Validate trường', flow: 'Xử lý / luồng', api: 'API' }

function CasesTab({ doc, cases }: { doc: ReqDoc; cases: ReqCase[] }) {
  const [off, setOff] = useState<Set<string>>(new Set())
  const [kinds, setKinds] = useState<Set<ReqCase['kind']>>(new Set(['ui', 'field', 'flow', 'api']))
  const [q, setQ] = useState('')
  const [tpl, setTpl] = useState(() => localStorage.getItem('reqTpl') ?? 'BES')
  const [code, setCode] = useState(() => localStorage.getItem(`reqCode:${doc.id}`) ?? (doc.code ? `PYC${doc.code}` : 'TC'))
  const [author, setAuthor] = useState(() => localStorage.getItem('reqAuthor') ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const shown = cases.filter((c) => kinds.has(c.kind) && (!q || `${c.group} ${c.purpose} ${c.expected}`.toLowerCase().includes(q.toLowerCase())))
  const picked = cases.filter((c) => kinds.has(c.kind) && !off.has(c.id))
  const groups = [...new Set(shown.map((c) => c.group))]
  const toggle = (ids: string[], on: boolean): void =>
    setOff((s) => {
      const n = new Set(s)
      for (const id of ids) {
        if (on) n.delete(id)
        else n.add(id)
      }
      return n
    })

  const exportIt = async (): Promise<void> => {
    localStorage.setItem('reqTpl', tpl)
    localStorage.setItem(`reqCode:${doc.id}`, code)
    localStorage.setItem('reqAuthor', author)
    setBusy(true)
    setMsg('')
    try {
      const out = await window.api.req.exportKbkt(doc.id, picked, { template: tpl, code, author, tester: author })
      setMsg(`Đã xuất ${picked.length} testcase → ${out}`)
    } catch (e) {
      setMsg(`Không xuất được: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rq-cases">
      <div className="rq-bar">
        {(Object.keys(KIND_LABEL) as ReqCase['kind'][]).map((k) => (
          <label key={k} className="mini-check">
            <input
              type="checkbox"
              checked={kinds.has(k)}
              onChange={(e) =>
                setKinds((s) => {
                  const n = new Set(s)
                  if (e.target.checked) n.add(k)
                  else n.delete(k)
                  return n
                })
              }
            />
            {KIND_LABEL[k]} ({cases.filter((c) => c.kind === k).length})
          </label>
        ))}
        <input className="input rq-search" placeholder="Lọc…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="rq-bar">
        <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value)} title="Mẫu KBKT">
          <option value="BES">Mẫu KBKT BES</option>
          <option value="BCCS">Mẫu KBKT BCCS</option>
        </select>
        <input className="input" style={{ width: 120 }} value={code} onChange={(e) => setCode(e.target.value)} title="Tiền tố mã testcase" />
        <input className="input" style={{ width: 130 }} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Người thực hiện" />
        <span className="spacer" />
        <button className="iconbtn primary" disabled={busy || !picked.length} onClick={() => void exportIt()}>
          {busy ? <Loader2 size={13} className="spin" /> : <FileSpreadsheet size={13} />} Xuất KBKT ({picked.length})
        </button>
      </div>
      {msg && <div className="rq-msg">{msg}</div>}
      <div className="rq-case-list">
        {groups.map((g) => {
          const list = shown.filter((c) => c.group === g)
          const allOn = list.every((c) => !off.has(c.id))
          return (
            <div key={g} className="rq-group">
              <button className="rq-group-head" onClick={() => toggle(list.map((c) => c.id), !allOn)}>
                {allOn ? <CheckSquare size={13} /> : <Square size={13} />}
                <b>{g}</b>
                <span className="muted">{list.filter((c) => !off.has(c.id)).length}/{list.length}</span>
              </button>
              {list.map((c) => (
                <div key={c.id} className={`rq-case ${off.has(c.id) ? 'off' : ''}`} onClick={() => toggle([c.id], off.has(c.id))}>
                  {off.has(c.id) ? <Square size={12} /> : <CheckSquare size={12} />}
                  <div className="rq-case-t">
                    <div>
                      <span className={`rq-kind k-${c.kind}`}>{KIND_LABEL[c.kind]}</span> {c.purpose}
                      {c.data && <span className="rq-data mono"> {c.data}</span>}
                    </div>
                    <div className="muted rq-exp">→ {c.expected}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ check on the phone */

function CheckTab({ doc, serial }: { doc: ReqDoc; serial: string }) {
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<ScreenScan | null>(null)
  const [matches, setMatches] = useState<ScreenMatch[]>([])
  const [pick, setPick] = useState('')
  const [err, setErr] = useState('')
  const { fill, msg } = useFill(serial)

  const run = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const s = await window.api.req.scan(serial)
      const m = matchScreens(doc, s)
      setScan(s)
      setMatches(m)
      if (!m.some((x) => x.screen.id === pick)) setPick(m[0]?.screen.id ?? '')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // Re-match when the user forces a screen that scored 0.
  const m = matches.find((x) => x.screen.id === pick) ?? (scan && pick ? matchScreens({ ...doc, screens: doc.screens.filter((s) => s.id === pick) }, scan)[0] : undefined)
  const missing = m?.checks.filter((c) => !c.found) ?? []
  const issues = m?.checks.filter((c) => c.issues.length) ?? []

  return (
    <div className="dt-body">
      <section className="mini-sec">
        <div className="mini-head">
          <ScanSearch size={14} />
          <b>Soát màn hình đang mở so với tài liệu</b>
          <span className="muted">đọc chữ & ô nhập trên điện thoại (native + WebView miniapp), không đọc giá trị đã nhập</span>
          <span className="spacer" />
          <button className="iconbtn primary" disabled={busy} onClick={() => void run()}>
            {busy ? <Loader2 size={13} className="spin" /> : <ScanSearch size={13} />} Quét màn hình
          </button>
        </div>
        {err && <div className="rq-msg bad">{err}</div>}
        {scan && (
          <div className="muted dt-note">
            App: {scan.pkg || '?'} · {scan.texts.length} dòng chữ · {scan.inputs.length} ô nhập{scan.pages.length ? ` · ${scan.pages.length} trang WebView` : ''}
            {scan.notes.map((n) => (
              <div key={n}>⚠ {n}</div>
            ))}
          </div>
        )}
        {scan && (
          <div className="rq-bar">
            <span className="muted">Màn hình trong tài liệu:</span>
            <select className="input grow" value={pick} onChange={(e) => setPick(e.target.value)}>
              {!matches.length && <option value="">— không màn nào khớp, chọn tay —</option>}
              {matches.map((x) => (
                <option key={x.screen.id} value={x.screen.id}>
                  {Math.round(x.score * 100)}% · {x.screen.title}
                </option>
              ))}
              {doc.screens.filter((s) => !matches.some((x) => x.screen.id === s.id)).map((s) => (
                <option key={s.id} value={s.id}>0% · {s.title}</option>
              ))}
            </select>
          </div>
        )}
      </section>
      {m && (
        <section className="mini-sec">
          <div className="mini-head">
            <b>{m.screen.title}</b>
            <span className="mini-tag">{m.checks.filter((c) => c.found).length}/{m.checks.length} thành phần thấy trên máy</span>
            {issues.length > 0 && <span className="mini-tag bad">{issues.length} điểm lệch tài liệu</span>}
          </div>
          {msg && <div className="rq-msg">{msg}</div>}
          {m.checks.map((c, i) => (
            <div key={i} className={`rq-chk ${c.found ? (c.issues.length ? 'warn' : 'ok') : 'miss'}`}>
              <span className="rq-chk-ic">{c.found ? (c.issues.length ? <AlertTriangle size={12} /> : <Check size={12} />) : <X size={12} />}</span>
              <div className="rq-chk-t">
                <div>
                  {c.field.title} <span className="muted">{c.field.type}</span>
                  {c.input && <span className="muted"> · ô {c.input.source === 'webview' ? 'WebView' : 'native'}{c.input.maxLength !== null ? `, maxlength ${c.input.maxLength}` : ''}{c.input.disabled || c.input.readOnly ? ', khoá' : ''}</span>}
                </div>
                {c.issues.map((x) => (
                  <div key={x} className="rq-issue">{x}</div>
                ))}
                {!c.found && <div className="muted">Không thấy trên màn hình (có thể nằm dưới – hãy cuộn rồi quét lại, hoặc chữ trên app khác tài liệu)</div>}
                {c.found && <Probes field={c.field} onFill={(p) => void fill(p, c.field)} />}
              </div>
            </div>
          ))}
          {missing.length === m.checks.length && <div className="muted">Không thành phần nào khớp – có thể đang mở màn khác.</div>}
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ panel */

export function ReqPanel({ serial }: { serial: string }) {
  const [docs, setDocs] = useState<ReqDocInfo[]>([])
  const [doc, setDoc] = useState<ReqDoc | null>(null)
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('reqTab') as Tab) || 'screens')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const cases = useMemo(() => (doc ? casesOf(doc) : []), [doc])
  // One API watcher for the whole panel, so captured calls survive switching tabs.
  const cap = useCapture(serial)

  const open = async (id: string): Promise<void> => {
    localStorage.setItem('reqDoc', id)
    setDoc(await window.api.req.get(id))
  }
  const refresh = async (): Promise<ReqDocInfo[]> => {
    const l = await window.api.req.list()
    setDocs(l)
    return l
  }
  useEffect(() => {
    void refresh().then((l) => {
      const last = localStorage.getItem('reqDoc')
      const id = l.find((d) => d.id === last)?.id ?? l[0]?.id
      if (id) void open(id).catch(() => undefined)
    })
  }, [])

  const importDoc = async (path?: string): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const d = await window.api.req.import(path)
      if (d) {
        await refresh()
        localStorage.setItem('reqDoc', d.id)
        setDoc(d)
      }
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (): Promise<void> => {
    if (!doc || !(await ask(`Xoá tài liệu “${doc.title}” khỏi ADB Kit?\n\nFile Word gốc không bị ảnh hưởng.`, { danger: true, ok: 'Xoá tài liệu' }))) return
    await window.api.req.remove(doc.id)
    const l = await refresh()
    setDoc(null)
    if (l[0]) void open(l[0].id)
  }
  const pick = (t: Tab): void => {
    setTab(t)
    localStorage.setItem('reqTab', t)
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) void importDoc(window.api.pathForFile(f))
  }

  return (
    <div className={`panel wide rq-panel ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <div className="panel-head rq-head">
        <FileText size={14} />
        <select className="input rq-doc" value={doc?.id ?? ''} onChange={(e) => void open(e.target.value)} disabled={!docs.length}>
          {!docs.length && <option value="">Chưa có tài liệu</option>}
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code ? `${d.code} · ` : ''}{d.title}
            </option>
          ))}
        </select>
        <button className="iconbtn" onClick={() => void importDoc()} disabled={busy} title="Nhập file Word (.docx) – hoặc kéo thả file vào đây">
          {busy ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} Nhập .docx
        </button>
        {doc && (
          <button className="iconbtn" onClick={() => void remove()} title="Xoá tài liệu khỏi ADB Kit">
            <Trash2 size={13} />
          </button>
        )}
        <span className="spacer" />
        {doc && (
          <div className="seg">
            <button className={tab === 'screens' ? 'on' : ''} onClick={() => pick('screens')}>Màn hình ({doc.screens.length})</button>
            <button className={tab === 'apis' ? 'on' : ''} onClick={() => pick('apis')}>API ({doc.apis.length})</button>
            <button className={tab === 'cases' ? 'on' : ''} onClick={() => pick('cases')}>Testcase ({cases.length})</button>
            <button className={tab === 'check' ? 'on' : ''} onClick={() => pick('check')}>Soát trên máy</button>
          </div>
        )}
      </div>
      {err && <div className="rq-msg bad rq-top-msg">{err}</div>}
      {doc?.notes.length ? <div className="muted rq-top-msg rq-note" title={doc.notes.join('\n')}>{doc.notes.join(' · ')}</div> : null}
      {!doc ? (
        <div className="rq-drop" onClick={() => void importDoc()}>
          <Upload size={28} />
          <b>Kéo thả tài liệu BA (.docx) vào đây hoặc bấm để chọn</b>
          <span className="muted">
            Hỗ trợ mẫu TLNV (bảng Title / Component Type / Editable / Mandatory, API “Danh mục – Nội dung chi tiết”) và MTYCTD (Tên / Loại Control / Bắt buộc / Độ dài tối đa / Read only,
            bảng Tham số API, Step). ADB Kit đọc ra danh sách màn hình, quy tắc từng trường, API, sinh testcase KBKT và soát màn hình trên điện thoại theo tài liệu.
          </span>
          <span className="muted">File .doc cũ: mở bằng Word → Lưu thành .docx. Tài liệu chỉ lưu trên máy này.</span>
        </div>
      ) : tab === 'screens' ? (
        <ScreensTab key={doc.id} doc={doc} serial={serial} />
      ) : tab === 'apis' ? (
        <ApisTab key={doc.id} doc={doc} cap={cap} />
      ) : tab === 'cases' ? (
        <CasesTab key={doc.id} doc={doc} cases={cases} />
      ) : (
        <CheckTab key={doc.id} doc={doc} serial={serial} />
      )}
    </div>
  )
}
