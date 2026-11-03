import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CircleDot, FlaskConical, Link2, Loader2, Play, Square, X } from 'lucide-react'
import type { NetCall } from '@shared/automation'
import type { ReqApi, ReqDoc } from '@shared/reqdoc'
import { conformIssues, conformance, endpointsOf, parseBody, scenariosOf, suggestPath, type ConformReport, type FieldMap, type ParamCheck, type Scenario } from '@shared/reqapi'

/* ------------------------------------------------------------ capture */

export interface Capture {
  pkg: string
  running: boolean
  starting: boolean
  calls: NetCall[]
  info: string
  active: { api: string; scenario: string; label: string; expect: string } | null
  start: () => Promise<void>
  stop: () => Promise<void>
  fake: (api: ReqApi, path: string, s: Scenario | null) => Promise<void>
}

/**
 * Watch the foreground app's API calls while this panel is open (the Mạng / API tab does the
 * same with its own watcher; only one panel is open at a time). Stopping removes any fake answer.
 */
export function useCapture(serial: string): Capture {
  const [pkg, setPkg] = useState('')
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [calls, setCalls] = useState<Map<string, NetCall>>(new Map())
  const [info, setInfo] = useState('')
  const [active, setActive] = useState<Capture['active']>(null)
  const runningRef = useRef(false)

  useEffect(() => {
    const off1 = window.api.net.onCalls((batch) => {
      if (!runningRef.current) return
      setCalls((m) => {
        const n = new Map(m)
        for (const c of batch) n.set(c.id, c)
        if (n.size > 2000) [...n.keys()].slice(0, n.size - 2000).forEach((k) => n.delete(k))
        return n
      })
    })
    const off2 = window.api.net.onInfo((m) => runningRef.current && setInfo(m))
    return () => {
      off1()
      off2()
      if (runningRef.current) void window.api.net.stop()
      runningRef.current = false
    }
  }, [])

  const start = async (): Promise<void> => {
    setStarting(true)
    try {
      const p = (await window.api.apps.foreground(serial)) ?? localStorage.getItem('netPkg') ?? ''
      if (!p) throw new Error('Không biết app nào đang mở — mở app cần test trên điện thoại trước')
      setPkg(p)
      setCalls(new Map())
      setActive(null)
      setInfo('Đang theo dõi — thao tác trên app để app gọi API')
      runningRef.current = true
      setRunning(true)
      await window.api.net.start(serial, p)
    } catch (e) {
      setInfo((e as Error).message)
    } finally {
      setStarting(false)
    }
  }
  const stop = async (): Promise<void> => {
    runningRef.current = false
    setRunning(false)
    setActive(null)
    await window.api.net.stop()
    setInfo('Đã dừng theo dõi (đã gỡ mọi giả lập)')
  }
  const fake = async (api: ReqApi, path: string, s: Scenario | null): Promise<void> => {
    try {
      await window.api.net.setMocks(s ? [{ ...s.rule, match: path }] : [])
      setActive(s ? { api: api.id, scenario: s.id, label: s.label, expect: s.expect } : null)
      setInfo(s ? `Đang giả lập “${s.label}” cho ${path} — thao tác lại trên app (tự hết sau 15 phút)` : 'Đã bỏ giả lập')
    } catch (e) {
      setInfo(`Không đặt được giả lập: ${(e as Error).message}`)
    }
  }
  const list = useMemo(() => [...calls.values()].sort((a, b) => a.startedAt - b.startedAt), [calls])
  return { pkg, running, starting, calls: list, info, active, start, stop, fake }
}

export function CaptureBar({ cap }: { cap: Capture }) {
  return (
    <div className="rq-cap">
      <CircleDot size={13} className={cap.running ? 'rq-live' : 'muted'} />
      {cap.running ? (
        <span>
          Đang bắt API của <b className="mono">{cap.pkg}</b> · {cap.calls.length} lời gọi
        </span>
      ) : (
        <span className="muted">Bắt API của app đang mở để đối chiếu với tài liệu và giả lập nhánh lỗi</span>
      )}
      <span className="spacer" />
      {cap.running ? (
        <button className="iconbtn" onClick={() => void cap.stop()}>
          <Square size={12} /> Dừng
        </button>
      ) : (
        <button className="iconbtn primary" disabled={cap.starting} onClick={() => void cap.start()}>
          {cap.starting ? <Loader2 size={12} className="spin" /> : <Play size={12} />} Bắt API
        </button>
      )}
      {cap.info && <div className="rq-cap-info muted">{cap.info}</div>}
    </div>
  )
}

/* ------------------------------------------------------------ per API */

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : d
  } catch {
    return d
  }
}

/** Saved endpoint for an API, else a guess from the doc URL / name. */
export function pathFor(doc: ReqDoc, api: ReqApi, calls: NetCall[]): { path: string; guessed: boolean } {
  const saved = localStorage.getItem(`reqPath:${doc.id}:${api.id}`)
  if (saved) return { path: saved, guessed: false }
  const g = suggestPath(api, calls)
  return { path: g ?? '', guessed: !!g }
}

export function reportFor(doc: ReqDoc, api: ReqApi, calls: NetCall[]): ConformReport | null {
  const { path } = pathFor(doc, api, calls)
  if (!path) return null
  return conformance(api, path, calls, load<FieldMap>(`reqFields:${doc.id}:${api.id}`, {}))
}

function ParamRows({ title, rows, keys, onMap, manual }: { title: string; rows: ParamCheck[]; keys: string[]; onMap: (name: string, key: string) => void; manual: (name: string) => boolean }) {
  if (!rows.length) return null
  return (
    <>
      <b className="rq-sub">{title}</b>
      <table className="rq-table">
        <tbody>
          {rows.map((p, i) => (
            <tr key={i} className={`rq-pc ${p.state}`}>
              <td className="rq-pc-ic">{p.state === 'ok' ? <Check size={12} /> : p.state === 'unmapped' ? <Link2 size={12} /> : p.state === 'type' ? <AlertTriangle size={12} /> : p.state === 'absent' ? <span>–</span> : <X size={12} />}</td>
              <td className="mono">
                {p.param.name}
                {p.param.required && <span className="rq-req">*</span>}
              </td>
              <td>
                {p.state === 'unmapped' || manual(p.param.name) ? (
                  <select className="input sm grow" value={p.key ?? ''} onChange={(e) => onMap(p.param.name, e.target.value)}>
                    <option value="">— ghép với trường… —</option>
                    {keys.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                ) : (
                  <span className="mono muted">{p.key}</span>
                )}
                {p.note && <div className={p.state === 'ok' || p.state === 'absent' ? 'muted' : 'rq-issue'}>{p.note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function ApiLive({ doc, api, cap }: { doc: ReqDoc; api: ReqApi; cap: Capture }) {
  const [, bump] = useState(0)
  const eps = useMemo(() => endpointsOf(cap.calls), [cap.calls])
  const { path, guessed } = pathFor(doc, api, cap.calls)
  const fields = load<FieldMap>(`reqFields:${doc.id}:${api.id}`, {})
  const report = path ? conformance(api, path, cap.calls, fields) : null
  const scenarios = useMemo(() => scenariosOf(api, doc), [api, doc])
  const setPath = (p: string): void => {
    if (p) localStorage.setItem(`reqPath:${doc.id}:${api.id}`, p)
    else localStorage.removeItem(`reqPath:${doc.id}:${api.id}`)
    bump((n) => n + 1)
  }
  const mapField = (dir: 'in' | 'out') => (name: string, key: string): void => {
    const k = `reqFields:${doc.id}:${api.id}`
    const m = load<FieldMap>(k, {})
    if (key) m[`${dir}:${name}`] = key
    else delete m[`${dir}:${name}`]
    localStorage.setItem(k, JSON.stringify(m))
    bump((n) => n + 1)
  }
  const reqKeys = report?.sample ? [...parseBody(report.sample.args).keys.keys()] : []
  const resKeys = report?.sample ? [...parseBody(report.sample.result).keys.keys()] : []
  const native = !!report?.calls.length && report.calls.every((c) => c.source === 'chucker')
  const fakeBlock = <FakeBlock api={api} path={path} cap={cap} scenarios={scenarios} native={native} />

  return (
    <div className="rq-live-box">
      <div className="rq-bar">
        <Link2 size={13} />
        <span className="muted">API trên máy:</span>
        <select className="input sm grow" value={path} onChange={(e) => setPath(e.target.value)} disabled={!cap.running && !eps.length}>
          <option value="">{eps.length ? '— chọn API đã bắt tương ứng —' : cap.running ? 'Chưa bắt được API nào — thao tác trên app' : 'Bấm “Bắt API” ở trên trước'}</option>
          {path && !eps.some((e) => e.path === path) && <option value={path}>{path} (chưa thấy lần này)</option>}
          {eps.map((e) => (
            <option key={`${e.method} ${e.path}`} value={e.path}>
              {e.method} {e.path} ({e.count})
            </option>
          ))}
        </select>
        {guessed && <span className="mini-tag" title="ADB Kit đoán theo đường dẫn / tên API trong tài liệu — chọn lại nếu sai">tự ghép</span>}
      </div>
      {fakeBlock}
      {report && !report.sample && <div className="muted rq-hint">Chưa thấy lời gọi {path} — thao tác tới màn hình dùng API này.</div>}
      {report?.sample && (
        <div className="rq-conform">
          <div className="muted rq-hint">
            Đối chiếu lần gọi gần nhất ({report.calls.length} lần): {report.sample.method} {report.sample.status ?? '…'} · {report.sample.durationMs ?? '?'} ms
          </div>
          <div className="rq-sum">
            {(() => {
              const all = [...report.inputs, ...report.outputs]
              const n = (s: ParamCheck['state']): number => all.filter((p) => p.state === s).length
              return (
                <>
                  <span className="mini-tag">{n('ok')} khớp</span>
                  {conformIssues(report) > 0 && <span className="mini-tag bad">{conformIssues(report)} lệch tài liệu</span>}
                  {n('absent') > 0 && <span className="mini-tag muted-tag">{n('absent')} trường chưa thấy</span>}
                  {n('unmapped') > 0 && <span className="mini-tag muted-tag">{n('unmapped')} cần ghép tên trường</span>}
                </>
              )
            })()}
          </div>
          {report.method && <div className="rq-issue">Phương thức: tài liệu {report.method.doc}, app gọi {report.method.real}</div>}
          {report.notes.map((n) => (
            <div key={n} className="muted">⚠ {n}</div>
          ))}
          <ParamRows title="Tham số gửi lên (theo tài liệu)" rows={report.inputs} keys={reqKeys} onMap={mapField('in')} manual={(n) => !!fields[`in:${n}`]} />
          {report.extraIn.length > 0 && <div className="muted rq-extra">App gửi thêm (tài liệu không ghi): <span className="mono">{report.extraIn.join(', ')}</span></div>}
          <ParamRows title="Trường trả về (theo tài liệu)" rows={report.outputs} keys={resKeys} onMap={mapField('out')} manual={(n) => !!fields[`out:${n}`]} />
          {report.extraOut.length > 0 && <div className="muted rq-extra">Response có thêm (tài liệu không ghi): <span className="mono">{report.extraOut.join(', ')}</span></div>}
          {!report.inputs.length && !report.outputs.length && <div className="muted">Tài liệu không liệt kê tham số của API này.</div>}
        </div>
      )}
    </div>
  )
}

function FakeBlock({ api, path, cap, scenarios, native }: { api: ReqApi; path: string; cap: Capture; scenarios: Scenario[]; native: boolean }) {
  const active = cap.active?.api === api.id ? cap.active : null
  return (
    <>
      <div className="rq-sc-head">
        <FlaskConical size={13} />
        <b>Giả lập nhánh lỗi</b>
        <span className="muted">app nhận phản hồi giả thay vì gọi server, để test nhánh tài liệu mô tả</span>
      </div>
      {!path && <div className="muted rq-hint">Ghép API trên máy ở trên trước (giả lập áp cho đường dẫn đó).</div>}
      {native && <div className="rq-issue">API này đọc từ Chucker (app native): đối chiếu được, nhưng không giả lập được phản hồi — giả lập chỉ áp cho WebView / miniapp.</div>}
      <div className="rq-scen">
        {scenarios.map((s) => (
          <button
            key={s.id}
            className={`rq-probe ${active?.scenario === s.id ? 'on' : ''}`}
            disabled={!path || !cap.running || native}
            title={`Tài liệu: ${s.expect}`}
            onClick={() => void cap.fake(api, path, active?.scenario === s.id ? null : s)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {active && (
        <div className="rq-active">
          <div>
            <b>Đang giả lập: {active.label}</b> — thao tác lại trên app rồi so với kỳ vọng:
          </div>
          <div className="rq-desc">{active.expect}</div>
          <button className="iconbtn" onClick={() => void cap.fake(api, path, null)}>
            <X size={12} /> Bỏ giả lập
          </button>
        </div>
      )}
    </>
  )
}
