import { useEffect, useMemo, useState } from 'react'
import {
  Bookmark,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  FlaskConical,
  KeyRound,
  ListPlus,
  Loader2,
  Play,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { emptyScript, type NetCall, type Script, type Step } from '@shared/automation'
import type { ReqApi } from '@shared/reqdoc'
import { pathOf, type FieldMap } from '@shared/reqapi'
import {
  applyLiveAuth,
  evalProbe,
  fromCurl,
  liveVarsOf,
  probesForRequest,
  requestFromCall,
  resolveEnvVars,
  toCurl,
  type ApiHeader,
  type ApiProbe,
  type ApiProbeRun,
  type ApiRequest,
  type ApiResponse,
  type SavedApiItem
} from '@shared/apilab'

const SAVED_KEY = 'adbkit:savedApis'
const ENV_KEY = 'adbkit:apiEnv'
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

function loadEnv(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ENV_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function saveEnv(vars: Record<string, string>): void {
  localStorage.setItem(ENV_KEY, JSON.stringify(vars))
}

function appendStepToScript(step: Step): void {
  let s: Script
  try {
    s = { ...emptyScript(), ...JSON.parse(localStorage.getItem('autoScript') ?? '{}') }
  } catch {
    s = emptyScript()
  }
  s.steps = [...s.steps, step]
  localStorage.setItem('autoScript', JSON.stringify(s))
}

function loadSaved(): SavedApiItem[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    return raw ? (JSON.parse(raw) as SavedApiItem[]) : []
  } catch {
    return []
  }
}

function saveList(items: SavedApiItem[]): void {
  localStorage.setItem(SAVED_KEY, JSON.stringify(items.slice(0, 100)))
}

function prettyJson(s: string): string {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function parseQuery(url: string): { base: string; params: { key: string; value: string }[] } {
  const qIdx = url.indexOf('?')
  if (qIdx < 0) return { base: url, params: [] }
  const base = url.slice(0, qIdx)
  const sp = new URLSearchParams(url.slice(qIdx + 1))
  const params: { key: string; value: string }[] = []
  sp.forEach((value, key) => params.push({ key, value }))
  return { base, params }
}

function buildUrl(base: string, params: { key: string; value: string }[]): string {
  const active = params.filter((p) => p.key.trim() !== '')
  if (!active.length) return base
  const sp = new URLSearchParams()
  for (const p of active) sp.append(p.key.trim(), p.value)
  return `${base}?${sp.toString()}`
}

export interface ApiLabProps {
  /** Initial captured call to edit/resend (optional). */
  call?: NetCall | null
  /** Initial request (if opened from a probe or saved item). */
  initialReq?: ApiRequest | null
  /** Start directly on the 'suite' tab if requested. */
  initialTab?: 'compose' | 'suite'
  /** All captured calls so far (used to sync live auth tokens). */
  calls: NetCall[]
  /** Optional package name for grouping saved requests. */
  pkg?: string
  /** Optional BA requirement API specification & field mapping for smarter test generation. */
  api?: ReqApi
  fieldMap?: FieldMap
  docCode?: string
  onClose: () => void
}

export function ApiLabModal({
  call,
  initialReq,
  initialTab = 'compose',
  calls,
  pkg,
  api,
  fieldMap,
  docCode,
  onClose
}: ApiLabProps) {
  const [tab, setTab] = useState<'compose' | 'suite'>(initialTab)
  const [req, setReq] = useState<ApiRequest>(() => {
    if (initialReq) return initialReq
    if (call) return requestFromCall(call)
    const saved = loadSaved()
    if (saved[0]) return saved[0].req
    return {
      method: api?.method?.toUpperCase() || 'POST',
      url: api?.url?.startsWith('http') ? api.url : `https://example.com${api?.url || '/api/v1/endpoint'}`,
      headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }],
      body: '{\n  \n}'
    }
  })

  const [reqTab, setReqTab] = useState<'body' | 'query' | 'headers' | 'env'>(() =>
    /^(GET|HEAD)$/i.test(req.method) && !req.body.trim() ? 'query' : 'body'
  )
  const [res, setRes] = useState<ApiResponse | null>(null)
  const [resView, setResView] = useState<'body' | 'headers' | 'diff'>('body')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState<SavedApiItem[]>(loadSaved)
  const [envVars, setEnvVars] = useState<Record<string, string>>(loadEnv)
  const liveVars = useMemo(() => liveVarsOf(calls), [calls])

  // Auto test suite state
  const resolvedBaseReq = useMemo(() => resolveEnvVars(req, envVars, calls), [req, envVars, calls])
  const probes = useMemo(() => probesForRequest(resolvedBaseReq, api, fieldMap), [resolvedBaseReq, api, fieldMap])
  const [runs, setRuns] = useState<Map<string, ApiProbeRun>>(new Map())
  const [runningSuite, setRunningSuite] = useState(false)
  const [selProbeId, setSelProbeId] = useState<string>('happy')
  const [tpl, setTpl] = useState(() => localStorage.getItem('reqTpl') ?? 'BES')
  const [code, setCode] = useState(() => docCode || localStorage.getItem('apiKbktCode') || 'TC_API')
  const [author, setAuthor] = useState(() => localStorage.getItem('reqAuthor') ?? '')
  const [exporting, setExporting] = useState(false)

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const flash = (msg: string): void => {
    setNotice(msg)
  }

  const sendNow = async (targetReq = req): Promise<void> => {
    if (!targetReq.url.trim()) return flash('Chưa nhập URL')
    setSending(true)
    setNotice('')
    try {
      const resolved = resolveEnvVars(targetReq, envVars, calls)
      const r = await window.api.net.send(resolved)
      setRes(r)
      if (r.error) flash(`Lỗi: ${r.error}`)
    } catch (e) {
      flash(`Không gửi được: ${(e as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  const addReqToAutoScript = (targetReq: ApiRequest, expectStatus = 0): void => {
    appendStepToScript({
      type: 'httpReq',
      method: targetReq.method,
      url: targetReq.url,
      headers: targetReq.headers,
      body: targetReq.body,
      useLiveAuth: true,
      expectStatus
    })
    flash(`Đã thêm bước "Bắn API ${targetReq.method} ${pathOf(targetReq.url)}" vào kịch bản Tự động test`)
  }

  const importPostman = async (): Promise<void> => {
    try {
      const r = await window.api.net.importPostman(pkg)
      if (!r) return
      const next = [...r.items, ...saved]
      setSaved(next)
      saveList(next)
      if (Object.keys(r.vars).length) {
        const mergedVars = { ...envVars, ...r.vars }
        setEnvVars(mergedVars)
        saveEnv(mergedVars)
      }
      if (r.items[0]) {
        setReq(r.items[0].req)
        setRes(null)
      }
      flash(`Đã nhập ${r.items.length} API từ Postman Collection "${r.name}"`)
    } catch (e) {
      flash(`Không nhập được Postman: ${(e as Error).message}`)
    }
  }

  const exportPostman = async (): Promise<void> => {
    const items: SavedApiItem[] = saved.length
      ? saved
      : [{ id: `${Date.now()}`, name: `${req.method} ${pathOf(req.url)}`, pkg, req, updatedAt: Date.now() }]
    try {
      const out = await window.api.net.exportPostman(pkg || 'ADB_Kit_APIs', items, envVars)
      if (out) flash(`Đã xuất ${items.length} API ra Postman Collection → ${out}`)
    } catch (e) {
      flash(`Không xuất được Postman: ${(e as Error).message}`)
    }
  }

  const syncToken = (): void => {
    const { req: next, updated } = applyLiveAuth(req, calls)
    if (!updated.length) {
      flash('Chưa tìm thấy header Authorization / Cookie / Token nào trong các lời gọi đã bắt từ máy')
      return
    }
    setReq(next)
    flash(`Đã đồng bộ ${updated.join(', ')} mới nhất từ điện thoại`)
  }

  const copyCurl = async (): Promise<void> => {
    const cmd = toCurl(req)
    await navigator.clipboard.writeText(cmd)
    flash('Đã copy lệnh cURL vào clipboard')
  }

  const pasteCurl = async (): Promise<void> => {
    try {
      const txt = await navigator.clipboard.readText()
      const parsed = fromCurl(txt)
      if (!parsed) {
        flash('Nội dung trong clipboard không phải lệnh cURL hợp lệ (bắt đầu bằng curl ...)')
        return
      }
      setReq(parsed)
      setRes(null)
      flash(`Đã nhập cURL: ${parsed.method} ${pathOf(parsed.url)}`)
    } catch (e) {
      flash(`Không đọc được clipboard: ${(e as Error).message}`)
    }
  }

  const saveCurrent = (): void => {
    const label = `${req.method} ${pathOf(req.url)}`
    const item: SavedApiItem = {
      id: `${Date.now()}`,
      name: label,
      pkg,
      req,
      updatedAt: Date.now()
    }
    const next = [item, ...saved.filter((s) => !(s.req.method === req.method && s.req.url === req.url))]
    setSaved(next)
    saveList(next)
    flash(`Đã lưu "${label}" vào sổ tay API`)
  }

  const deleteSaved = (id: string): void => {
    const next = saved.filter((s) => s.id !== id)
    setSaved(next)
    saveList(next)
  }

  const formatBody = (): void => {
    if (!req.body.trim()) return
    try {
      setReq({ ...req, body: JSON.stringify(JSON.parse(req.body), null, 2) })
    } catch (e) {
      flash(`Body không phải JSON hợp lệ: ${(e as Error).message}`)
    }
  }

  // Query parameters editor helpers
  const { base: baseUrl, params: queryParams } = useMemo(() => parseQuery(req.url), [req.url])
  const updateQueryParam = (idx: number, field: 'key' | 'value', val: string): void => {
    const next = queryParams.map((p, i) => (i === idx ? { ...p, [field]: val } : p))
    setReq({ ...req, url: buildUrl(baseUrl, next) })
  }
  const addQueryParam = (): void => {
    const next = [...queryParams, { key: 'param', value: '' }]
    setReq({ ...req, url: buildUrl(baseUrl, next) })
  }
  const removeQueryParam = (idx: number): void => {
    const next = queryParams.filter((_, i) => i !== idx)
    setReq({ ...req, url: buildUrl(baseUrl, next) })
  }

  // Headers editor helpers
  const updateHeader = (idx: number, patch: Partial<ApiHeader>): void => {
    setReq({
      ...req,
      headers: req.headers.map((h, i) => (i === idx ? { ...h, ...patch } : h))
    })
  }
  const addHeader = (): void => {
    setReq({
      ...req,
      headers: [...req.headers, { name: '', value: '', enabled: true }]
    })
  }
  const removeHeader = (idx: number): void => {
    setReq({
      ...req,
      headers: req.headers.filter((_, i) => i !== idx)
    })
  }

  // Run all probes in the suite
  const runSuite = async (): Promise<void> => {
    if (runningSuite) return
    setRunningSuite(true)
    setRuns(new Map())
    setNotice('')
    try {
      for (const p of probes) {
        const r = await window.api.net.send(p.req)
        const ev = evalProbe(p, r)
        const run: ApiProbeRun = { probe: p, res: r, ...ev }
        setRuns((prev) => {
          const next = new Map(prev)
          next.set(p.id, run)
          return next
        })
      }
    } finally {
      setRunningSuite(false)
    }
  }

  const runSingleProbe = async (p: ApiProbe): Promise<void> => {
    const r = await window.api.net.send(p.req)
    const ev = evalProbe(p, r)
    setRuns((prev) => {
      const next = new Map(prev)
      next.set(p.id, { probe: p, res: r, ...ev })
      return next
    })
  }

  const exportKbkt = async (): Promise<void> => {
    const list = probes.map((p) => runs.get(p.id)).filter((x): x is ApiProbeRun => !!x)
    if (!list.length) return flash('Hãy bấm "Chạy tất cả" trước khi xuất KBKT')
    localStorage.setItem('reqTpl', tpl)
    localStorage.setItem('apiKbktCode', code)
    localStorage.setItem('reqAuthor', author)
    setExporting(true)
    try {
      const title = api?.name || `Kiểm thử API ${req.method} ${pathOf(req.url)}`
      const out = await window.api.net.exportKbkt(list, { template: tpl, title, code, author })
      flash(`Đã xuất ${list.length} kịch bản test API (kèm kết quả P/F) → ${out}`)
    } catch (e) {
      flash(`Không xuất được KBKT: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  const passCount = [...runs.values()].filter((r) => r.pass).length
  const failCount = [...runs.values()].filter((r) => !r.pass).length
  const selectedProbe = probes.find((p) => p.id === selProbeId) ?? probes[0]
  const selectedRun = selectedProbe ? runs.get(selectedProbe.id) : undefined

  return (
    <div className="apilab-backdrop" onClick={onClose}>
      <div className="apilab-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="apilab-head">
          <FlaskConical size={16} className="apilab-ico" />
          <b>Kiểm thử API chủ động (API Tester)</b>
          {api && <span className="mini-tag">{api.name}</span>}
          {call?.source === 'chucker' && <span className="mini-tag">Lấy từ Chucker (App Native)</span>}
          <div className="apilab-tabs">
            <button className={`apilab-tab ${tab === 'compose' ? 'on' : ''}`} onClick={() => setTab('compose')}>
              <Send size={13} /> Soạn &amp; Bắn thử
            </button>
            <button className={`apilab-tab ${tab === 'suite' ? 'on' : ''}`} onClick={() => setTab('suite')}>
              <Sparkles size={13} /> Bộ test tự động ({probes.length})
              {failCount > 0 && <span className="apilab-badge bad">{failCount} lỗi</span>}
              {failCount === 0 && passCount > 0 && <span className="apilab-badge ok">{passCount} đạt</span>}
            </button>
          </div>
          <span className="spacer" />
          <button className="iconbtn ghost" onClick={onClose} title="Đóng (Esc)">
            <X size={15} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="apilab-urlbar">
          <select
            className="input apilab-method"
            value={req.method}
            onChange={(e) => setReq({ ...req, method: e.target.value })}
            aria-label="HTTP Method"
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            className="input mono apilab-url"
            placeholder="https://api.example.com/v1/..."
            value={req.url}
            onChange={(e) => setReq({ ...req, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || tab === 'compose')) void sendNow()
            }}
          />
          {tab === 'compose' ? (
            <button className="iconbtn primary" disabled={sending} onClick={() => void sendNow()} title="Gửi request lên Server (Enter)">
              {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Gửi thử
            </button>
          ) : (
            <button className="iconbtn primary" disabled={runningSuite} onClick={() => void runSuite()} title="Tự động bắn toàn bộ kịch bản kiểm thử đầu vào & bảo mật">
              {runningSuite ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Chạy {probes.length} kịch bản
            </button>
          )}
          <button className="iconbtn" onClick={syncToken} title="Lấy Authorization / Cookie mới nhất vừa bắt được từ điện thoại đắp vào request này">
            <KeyRound size={13} /> Lấy Token từ máy
          </button>
          <button className="iconbtn" onClick={() => void copyCurl()} title="Copy lệnh cURL để gửi cho Dev Backend">
            <ClipboardCopy size={13} /> Copy cURL
          </button>
          <button className="iconbtn" onClick={() => void pasteCurl()} title="Dán lệnh cURL từ clipboard vào đây">
            <ClipboardPaste size={13} /> Dán cURL
          </button>
          <button className="iconbtn" onClick={saveCurrent} title="Lưu API này vào sổ tay để dùng lại">
            <Bookmark size={13} /> Lưu
          </button>
          <button
            className="iconbtn"
            onClick={() => addReqToAutoScript(req, res?.status && res.status >= 200 && res.status < 300 ? res.status : 0)}
            title="Thêm bước 'Bắn API lên Server' với cấu hình này vào tab Tự động test"
          >
            <ListPlus size={13} /> + Kịch bản
          </button>
          <button className="iconbtn" onClick={() => void importPostman()} title="Nhập file Postman Collection v2.1 (.json)">
            <Upload size={13} /> Nhập Postman
          </button>
          <button className="iconbtn" onClick={() => void exportPostman()} title="Xuất sổ tay API ra file Postman Collection v2.1 (.json)">
            <Download size={13} /> Xuất Postman
          </button>
          {saved.length > 0 && (
            <select
              className="input sm"
              style={{ maxWidth: 170 }}
              value=""
              onChange={(e) => {
                const val = e.target.value
                if (val.startsWith('del:')) {
                  deleteSaved(val.slice(4))
                  return
                }
                const hit = saved.find((s) => s.id === val)
                if (hit) {
                  setReq(hit.req)
                  setRes(null)
                }
              }}
              aria-label="Sổ tay API đã lưu"
            >
              <option value="">Sổ tay ({saved.length})…</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {notice && (
          <div className="apilab-notice">
            <span>{notice}</span>
            <button className="iconbtn ghost" onClick={() => setNotice('')}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* TAB 1: COMPOSE & DIFF */}
        {tab === 'compose' && (
          <div className="apilab-split">
            {/* Left: Request Editor */}
            <div className="apilab-pane">
              <div className="apilab-subbar">
                <button className={`apilab-subtab ${reqTab === 'body' ? 'on' : ''}`} onClick={() => setReqTab('body')}>
                  Body {req.body.trim() ? '•' : ''}
                </button>
                <button className={`apilab-subtab ${reqTab === 'query' ? 'on' : ''}`} onClick={() => setReqTab('query')}>
                  Query ({queryParams.length})
                </button>
                <button className={`apilab-subtab ${reqTab === 'headers' ? 'on' : ''}`} onClick={() => setReqTab('headers')}>
                  Headers ({req.headers.filter((h) => h.enabled).length})
                </button>
                <button className={`apilab-subtab ${reqTab === 'env' ? 'on' : ''}`} onClick={() => setReqTab('env')} title="Biến môi trường {{token}}, {{baseUrl}}…">
                  Biến {'{{…}}'} ({Object.keys(liveVars).length + Object.keys(envVars).length})
                </button>
                <span className="spacer" />
                {reqTab === 'body' && (
                  <button className="iconbtn ghost" onClick={formatBody} title="Làm đẹp JSON">
                    Format JSON
                  </button>
                )}
                {reqTab === 'query' && (
                  <button className="iconbtn ghost" onClick={addQueryParam}>
                    <Plus size={12} /> Thêm param
                  </button>
                )}
                {reqTab === 'headers' && (
                  <button className="iconbtn ghost" onClick={addHeader}>
                    <Plus size={12} /> Thêm header
                  </button>
                )}
                {reqTab === 'env' && (
                  <button
                    className="iconbtn ghost"
                    onClick={() => {
                      const next = { ...envVars, [`var_${Object.keys(envVars).length + 1}`]: '' }
                      setEnvVars(next)
                      saveEnv(next)
                    }}
                  >
                    <Plus size={12} /> Thêm biến
                  </button>
                )}
              </div>

              {reqTab === 'body' && (
                <textarea
                  className="input mono apilab-textarea"
                  placeholder={/^(GET|HEAD)$/i.test(req.method) ? 'Request GET/HEAD thường không gửi kèm Body (chuyển sang tab Query để sửa tham số trên URL)' : '{\n  "key": "value"\n}'}
                  value={req.body}
                  onChange={(e) => setReq({ ...req, body: e.target.value })}
                  spellCheck={false}
                />
              )}

              {reqTab === 'query' && (
                <div className="apilab-kv-list">
                  {queryParams.length === 0 && (
                    <div className="muted" style={{ padding: 14 }}>
                      URL chưa có tham số query (<code>?key=value</code>). Bấm <b>+ Thêm param</b> để thêm.
                    </div>
                  )}
                  {queryParams.map((p, i) => (
                    <div key={i} className="apilab-kv-row">
                      <input
                        className="input sm mono"
                        placeholder="Tên tham số"
                        value={p.key}
                        onChange={(e) => updateQueryParam(i, 'key', e.target.value)}
                      />
                      <input
                        className="input sm mono grow"
                        placeholder="Giá trị"
                        value={p.value}
                        onChange={(e) => updateQueryParam(i, 'value', e.target.value)}
                      />
                      <button className="iconbtn ghost" onClick={() => removeQueryParam(i)} title="Xoá tham số">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {reqTab === 'headers' && (
                <div className="apilab-kv-list">
                  <div className="muted" style={{ padding: '6px 10px', fontSize: 12 }}>
                    Bỏ tích <code>Authorization</code> / <code>Cookie</code> để test nhanh trường hợp không gửi token (401/403).
                  </div>
                  {req.headers.map((h, i) => (
                    <div key={i} className={`apilab-kv-row ${h.enabled ? '' : 'dim'}`}>
                      <input
                        type="checkbox"
                        checked={h.enabled}
                        onChange={(e) => updateHeader(i, { enabled: e.target.checked })}
                        title="Bật / tắt header này"
                      />
                      <input
                        className="input sm mono"
                        placeholder="Header (VD: Authorization)"
                        value={h.name}
                        onChange={(e) => updateHeader(i, { name: e.target.value })}
                      />
                      <input
                        className="input sm mono grow"
                        placeholder="Giá trị"
                        value={h.value}
                        onChange={(e) => updateHeader(i, { value: e.target.value })}
                      />
                      <button className="iconbtn ghost" onClick={() => removeHeader(i)} title="Xoá header">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {reqTab === 'env' && (
                <div className="apilab-kv-list">
                  <div className="muted" style={{ padding: '6px 10px', fontSize: 12, lineHeight: 1.5 }}>
                    Dùng cú pháp <code>{'{{token}}'}</code>, <code>{'{{baseUrl}}'}</code> hoặc tên biến bất kỳ trong URL, Header, Body. Các biến từ máy được cập nhật tự động theo gói tin mới nhất.
                  </div>
                  {Object.entries(liveVars).map(([k, v]) => (
                    <div key={`live:${k}`} className="apilab-kv-row">
                      <span className="mini-tag">Tự động từ máy</span>
                      <code className="mono" style={{ minWidth: 110 }}>{`{{${k}}}`}</code>
                      <input className="input sm mono grow" value={v} readOnly />
                    </div>
                  ))}
                  {Object.entries(envVars).map(([k, v], idx) => (
                    <div key={idx} className="apilab-kv-row">
                      <input
                        className="input sm mono"
                        placeholder="Tên biến (vd: baseUrl)"
                        value={k}
                        onChange={(e) => {
                          const entries = Object.entries(envVars)
                          entries[idx] = [e.target.value.trim(), v]
                          const next = Object.fromEntries(entries.filter(([key]) => key))
                          setEnvVars(next)
                          saveEnv(next)
                        }}
                      />
                      <input
                        className="input sm mono grow"
                        placeholder="Giá trị biến"
                        value={v}
                        onChange={(e) => {
                          const next = { ...envVars, [k]: e.target.value }
                          setEnvVars(next)
                          saveEnv(next)
                        }}
                      />
                      <button
                        className="iconbtn ghost"
                        onClick={() => {
                          const next = { ...envVars }
                          delete next[k]
                          setEnvVars(next)
                          saveEnv(next)
                        }}
                        title="Xoá biến"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Response Viewer */}
            <div className="apilab-pane">
              <div className="apilab-subbar">
                <b>Phản hồi từ Server</b>
                {res && (
                  <>
                    <span className={`mini-tag ${res.status >= 200 && res.status < 300 ? '' : 'bad'}`}>
                      {res.status ? `HTTP ${res.status} ${res.statusText}` : 'Lỗi kết nối'}
                    </span>
                    <span className="muted">{res.durationMs} ms</span>
                    <span className="muted">{(res.size / 1024).toFixed(1)} KB</span>
                  </>
                )}
                <span className="spacer" />
                {res && (
                  <>
                    <button className={`apilab-subtab ${resView === 'body' ? 'on' : ''}`} onClick={() => setResView('body')}>
                      Body
                    </button>
                    <button className={`apilab-subtab ${resView === 'headers' ? 'on' : ''}`} onClick={() => setResView('headers')}>
                      Headers ({res.headers.length})
                    </button>
                    {call?.result && (
                      <button className={`apilab-subtab ${resView === 'diff' ? 'on' : ''}`} onClick={() => setResView('diff')}>
                        So với gốc trên máy
                      </button>
                    )}
                  </>
                )}
              </div>

              {!res && !sending && (
                <div className="apilab-empty muted">
                  Chỉnh sửa tham số bên trái rồi bấm <b>Gửi thử</b> để xem Server trả về gì.
                  {call?.result && (
                    <div className="apilab-orig-preview">
                      <div className="panel-title">Phản hồi gốc bắt từ điện thoại (HTTP {call.status ?? '?'})</div>
                      <pre className="mono">{prettyJson(call.result)}</pre>
                    </div>
                  )}
                </div>
              )}

              {sending && (
                <div className="apilab-empty muted">
                  <Loader2 size={20} className="spin" /> Đang gửi request tới Server…
                </div>
              )}

              {res && !sending && resView === 'body' && (
                <pre className="apilab-pre mono">{res.error ? `Lỗi: ${res.error}` : prettyJson(res.body) || '(Phản hồi rỗng)'}</pre>
              )}

              {res && !sending && resView === 'headers' && (
                <pre className="apilab-pre mono">{res.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}</pre>
              )}

              {res && !sending && resView === 'diff' && call?.result && (
                <div className="apilab-diff">
                  <div>
                    <div className="panel-title">Bản gốc trên máy (HTTP {call.status ?? '?'})</div>
                    <pre className="apilab-pre mono">{prettyJson(call.result)}</pre>
                  </div>
                  <div>
                    <div className="panel-title">Bản vừa bắn thử (HTTP {res.status})</div>
                    <pre className="apilab-pre mono">{prettyJson(res.body)}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: AUTO TEST SUITE (NEGATIVE / BOUNDARY / AUTH) */}
        {tab === 'suite' && (
          <div className="apilab-suite-wrap">
            <div className="apilab-suite-bar">
              <span className="muted">
                Tự động sinh <b>{probes.length} kịch bản</b> kiểm thử Backend (Happy case, Bỏ Token, Token sai, Thiếu trường bắt buộc, Truyền rỗng, Sai kiểu dữ liệu, SQLi/XSS).
              </span>
              <span className="spacer" />
              <span className="muted">Mẫu KBKT:</span>
              <select className="input sm" value={tpl} onChange={(e) => setTpl(e.target.value)}>
                <option value="BES">BES</option>
                <option value="BCCS">BCCS</option>
              </select>
              <input
                className="input sm"
                style={{ width: 110 }}
                placeholder="Mã KBKT"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <input
                className="input sm"
                style={{ width: 130 }}
                placeholder="Người kiểm thử"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
              <button className="iconbtn" disabled={!runs.size || exporting} onClick={() => void exportKbkt()} title="Xuất toàn bộ kịch bản và kết quả Pass/Fail ra file Excel KBKT">
                {exporting ? <Loader2 size={13} className="spin" /> : <FileSpreadsheet size={13} />} Xuất KBKT ({runs.size})
              </button>
            </div>

            <div className="apilab-split">
              {/* Left: Probe List */}
              <div className="apilab-probe-list">
                {probes.map((p, idx) => {
                  const r = runs.get(p.id)
                  return (
                    <div
                      key={p.id}
                      className={`apilab-probe-row ${selProbeId === p.id ? 'sel' : ''} ${r ? (r.pass ? 'pass' : 'fail') : ''}`}
                      onClick={() => setSelProbeId(p.id)}
                    >
                      <span className="apilab-probe-no">{idx + 1}</span>
                      <div className="apilab-probe-main">
                        <div className="apilab-probe-title">
                          <b>{p.label}</b>
                          <span className="muted mono">{p.dataLabel}</span>
                        </div>
                        <div className="apilab-probe-sub muted">{r ? r.reason : `Kỳ vọng: ${p.expectedText}`}</div>
                      </div>
                      <div className="apilab-probe-right">
                        {r ? (
                          <span className={`mini-tag ${r.pass ? '' : 'bad'}`}>
                            {r.pass ? <Check size={11} /> : <X size={11} />} {r.status} · {r.res.status || 'ERR'}
                          </span>
                        ) : (
                          <button
                            className="iconbtn ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              void runSingleProbe(p)
                            }}
                            title="Chạy thử riêng kịch bản này"
                          >
                            <Play size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Right: Selected Probe Details */}
              {selectedProbe && (
                <div className="apilab-pane">
                  <div className="apilab-subbar">
                    <b>{selectedProbe.label}</b>
                    <span className="spacer" />
                    <button
                      className="iconbtn"
                      onClick={() => void runSingleProbe(selectedProbe)}
                      title="Bắn lại kịch bản này"
                    >
                      <Play size={12} /> Chạy lại
                    </button>
                    <button
                      className="iconbtn"
                      onClick={() =>
                        addReqToAutoScript(
                          selectedProbe.req,
                          selectedRun?.res.status ?? (selectedProbe.expect === 'ok' ? 200 : selectedProbe.expect === 'auth_err' ? 401 : 400)
                        )
                      }
                      title="Thêm kịch bản API này thành 1 bước trong tab Tự động test"
                    >
                      <ListPlus size={12} /> + Kịch bản
                    </button>
                    <button
                      className="iconbtn"
                      onClick={() => {
                        setReq(selectedProbe.req)
                        if (selectedRun) setRes(selectedRun.res)
                        setTab('compose')
                      }}
                      title="Đưa request của kịch bản này sang tab Soạn & Bắn thử để chỉnh sửa thêm"
                    >
                      <Send size={12} /> Mở bên Soạn &amp; Bắn thử
                    </button>
                  </div>
                  <div className="apilab-probe-detail">
                    <div className="rq-desc">
                      <b>Mục đích:</b> {selectedProbe.purpose}
                    </div>
                    <div className="rq-desc">
                      <b>Kỳ vọng:</b> {selectedProbe.expectedText}
                    </div>
                    {selectedRun && (
                      <div className={`apilab-verdict ${selectedRun.pass ? 'ok' : 'bad'}`}>
                        <b>Kết quả ({selectedRun.status}):</b> {selectedRun.reason}
                      </div>
                    )}
                    <div className="panel-title">Request gửi đi ({selectedProbe.req.method} {pathOf(selectedProbe.req.url)})</div>
                    <pre className="apilab-pre mono" style={{ maxHeight: 180 }}>
                      {selectedProbe.req.body || toCurl(selectedProbe.req)}
                    </pre>
                    {selectedRun && (
                      <>
                        <div className="panel-title">
                          Phản hồi từ Server (HTTP {selectedRun.res.status} · {selectedRun.res.durationMs} ms)
                        </div>
                        <pre className="apilab-pre mono">
                          {selectedRun.res.error ? selectedRun.res.error : prettyJson(selectedRun.res.body) || '(Trống)'}
                        </pre>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
