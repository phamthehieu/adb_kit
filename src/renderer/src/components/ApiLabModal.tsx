import { useEffect, useMemo, useState } from 'react'
import {
  Bookmark,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Globe,
  KeyRound,
  ListPlus,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { emptyScript, type NetCall, type Script, type Step } from '@shared/automation'
import { shortApi, type ReqApi, type ReqDoc, type ReqDocInfo } from '@shared/reqdoc'
import { apiCalls, pathOf, suggestPath, type FieldMap } from '@shared/reqapi'
import {
  applyLiveAuth,
  autoFindTokenInResponse,
  evalProbe,
  flattenJsonLeaves,
  fromCurl,
  importOpenApiSpec,
  liveVarsOf,
  probesForRequest,
  requestFromCall,
  requestFromDocApi,
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
const AUTH_CFG_KEY = 'adbkit:authConfig'
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

interface DirectAuthConfig {
  method: string
  url: string
  body: string
  tokenPath: string
}

function loadAuthConfig(): DirectAuthConfig {
  try {
    const raw = localStorage.getItem(AUTH_CFG_KEY)
    if (raw) return JSON.parse(raw) as DirectAuthConfig
  } catch {
    /* ignore */
  }
  return {
    method: 'POST',
    url: '{{baseUrl}}/api/v1/auth/login',
    body: '{\n  "username": "",\n  "password": ""\n}',
    tokenPath: ''
  }
}

function saveAuthConfig(cfg: DirectAuthConfig): void {
  localStorage.setItem(AUTH_CFG_KEY, JSON.stringify(cfg))
}

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
  localStorage.setItem(SAVED_KEY, JSON.stringify(items.slice(0, 150)))
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
  call: initialCall,
  initialReq,
  initialTab = 'compose',
  calls,
  pkg,
  api: initialApi,
  fieldMap: initialFieldMap,
  docCode,
  onClose
}: ApiLabProps) {
  const [tab, setTab] = useState<'compose' | 'suite'>(initialTab)
  const [activeCall, setActiveCall] = useState<NetCall | null>(initialCall ?? null)
  const [activeApi, setActiveApi] = useState<ReqApi | undefined>(initialApi)
  const [activeFieldMap, setActiveFieldMap] = useState<FieldMap | undefined>(initialFieldMap)

  const [envVars, setEnvVars] = useState<Record<string, string>>(loadEnv)
  const liveVars = useMemo(() => liveVarsOf(calls), [calls])

  const [req, setReq] = useState<ApiRequest>(() => {
    if (initialReq) return initialReq
    if (initialCall) return requestFromCall(initialCall)
    const env = loadEnv()
    const base = env.baseUrl || liveVarsOf(calls).baseUrl || '{{baseUrl}}'
    if (initialApi) return requestFromDocApi(initialApi, base, initialFieldMap)
    const saved = loadSaved()
    if (saved[0]) return saved[0].req
    return {
      method: 'POST',
      url: `${base}/api/v1/endpoint`,
      headers: [
        { name: 'Content-Type', value: 'application/json', enabled: true },
        { name: 'Authorization', value: 'Bearer {{token}}', enabled: true }
      ],
      body: '{\n  \n}'
    }
  })

  // Sidebar state (allows full standalone workflow even when FE is dead)
  const [showSidebar, setShowSidebar] = useState<boolean>(() => !initialCall || loadSaved().length > 0)
  const [sideTab, setSideTab] = useState<'saved' | 'doc' | 'live'>(() => {
    if (initialApi && !initialCall) return 'doc'
    if (initialCall) return 'live'
    return 'saved'
  })
  const [sideSearch, setSideSearch] = useState('')

  // Standalone BA Requirement Docs state (loaded directly from main process)
  const [docList, setDocList] = useState<ReqDocInfo[]>([])
  const [selDocId, setSelDocId] = useState<string>('')
  const [currentDoc, setCurrentDoc] = useState<ReqDoc | null>(null)

  useEffect(() => {
    window.api.req
      .list()
      .then((list) => {
        setDocList(list)
        if (list[0]) setSelDocId((prev) => prev || list[0].id)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!selDocId) {
      setCurrentDoc(null)
      return
    }
    window.api.req
      .get(selDocId)
      .then((d) => setCurrentDoc(d))
      .catch(() => undefined)
  }, [selDocId])

  // Direct Server Auth (Login without FE) & Swagger URL import popovers
  const [showAuthBox, setShowAuthBox] = useState(false)
  const [authCfg, setAuthCfg] = useState<DirectAuthConfig>(loadAuthConfig)
  const [loggingIn, setLoggingIn] = useState(false)
  const [showSwaggerBox, setShowSwaggerBox] = useState(false)
  const [swaggerUrl, setSwaggerUrl] = useState('')
  const [loadingSwagger, setLoadingSwagger] = useState(false)

  const [reqTab, setReqTab] = useState<'body' | 'query' | 'headers' | 'env'>(() =>
    /^(GET|HEAD)$/i.test(req.method) && !req.body.trim() ? 'query' : 'body'
  )
  const [res, setRes] = useState<ApiResponse | null>(null)
  const [resView, setResView] = useState<'body' | 'headers' | 'vars' | 'diff'>('body')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState<SavedApiItem[]>(loadSaved)

  // Auto test suite state
  const resolvedBaseReq = useMemo(() => resolveEnvVars(req, envVars, calls), [req, envVars, calls])
  const probes = useMemo(
    () => probesForRequest(resolvedBaseReq, activeApi, activeFieldMap),
    [resolvedBaseReq, activeApi, activeFieldMap]
  )
  const [runs, setRuns] = useState<Map<string, ApiProbeRun>>(new Map())
  const [runningSuite, setRunningSuite] = useState(false)
  const [selProbeId, setSelProbeId] = useState<string>('happy')
  const [tpl, setTpl] = useState(() => localStorage.getItem('reqTpl') ?? 'BES')
  const [code, setCode] = useState(() => docCode || localStorage.getItem('apiKbktCode') || 'TC_API')
  const [author, setAuthor] = useState(() => localStorage.getItem('reqAuthor') ?? '')
  const [exporting, setExporting] = useState(false)

  const resLeaves = useMemo(() => (res?.body ? flattenJsonLeaves(res.body) : []), [res?.body])
  const httpCalls = useMemo(() => [...apiCalls(calls)].reverse(), [calls])

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

  const updateEnvVar = (key: string, val: string): void => {
    const next = { ...envVars, [key]: val }
    setEnvVars(next)
    saveEnv(next)
  }

  const ensureBearerTokenHeader = (target: ApiRequest): ApiRequest => {
    const headers = target.headers.map((h) => ({ ...h }))
    const idx = headers.findIndex((h) => h.name.toLowerCase() === 'authorization')
    if (idx >= 0) {
      headers[idx] = { name: headers[idx].name, value: 'Bearer {{token}}', enabled: true }
    } else {
      headers.unshift({ name: 'Authorization', value: 'Bearer {{token}}', enabled: true })
    }
    return { ...target, headers }
  }

  // Direct Backend Login (independent of FE)
  const loginDirectToServer = async (): Promise<void> => {
    if (!authCfg.url.trim()) return flash('Chưa nhập URL của API Đăng nhập')
    saveAuthConfig(authCfg)
    setLoggingIn(true)
    try {
      const loginReq: ApiRequest = {
        method: authCfg.method || 'POST',
        url: authCfg.url.trim(),
        headers: [
          { name: 'Content-Type', value: 'application/json', enabled: true },
          { name: 'Accept', value: 'application/json', enabled: true }
        ],
        body: authCfg.body
      }
      const resolved = resolveEnvVars(loginReq, envVars, calls)
      const r = await window.api.net.send(resolved)
      if (r.error || r.status === 0) {
        flash(`Lỗi gọi API Login: ${r.error || 'Không kết nối được tới Server'}`)
        return
      }
      const found = autoFindTokenInResponse(r.body, authCfg.tokenPath)
      if (!found) {
        setRes(r)
        flash(
          `API Login trả về HTTP ${r.status} nhưng chưa tự tìm thấy trường chứa Token. Hãy xem kết quả bên phải và điền tên trường (VD: data.accessToken) vào ô đường dẫn Token.`
        )
        return
      }
      const nextVars: Record<string, string> = { ...envVars, token: found.token, access_token: found.token }
      const m = /^(https?:\/\/[^/]+)/i.exec(resolved.url)
      if (m && !nextVars.baseUrl) nextVars.baseUrl = m[1]
      setEnvVars(nextVars)
      saveEnv(nextVars)
      setReq((prev) => ensureBearerTokenHeader(prev))
      setShowAuthBox(false)
      flash(`Đã đăng nhập trực tiếp Server (HTTP ${r.status}) & lấy Token từ "${found.path}" nạp vào {{token}}!`)
    } catch (e) {
      flash(`Không gọi được API Login: ${(e as Error).message}`)
    } finally {
      setLoggingIn(false)
    }
  }

  // Fetch Swagger / OpenAPI JSON directly from a URL
  const fetchSwaggerFromUrl = async (): Promise<void> => {
    const u = swaggerUrl.trim()
    if (!u) return flash('Hãy nhập đường dẫn URL tới file Swagger / OpenAPI JSON (VD: https://.../v3/api-docs)')
    setLoadingSwagger(true)
    try {
      const r = await window.api.net.send({
        method: 'GET',
        url: u,
        headers: [{ name: 'Accept', value: 'application/json', enabled: true }],
        body: ''
      })
      if (r.error || !r.body.trim()) {
        flash(`Không tải được Swagger từ URL: ${r.error || `HTTP ${r.status}`}`)
        return
      }
      const parsed = importOpenApiSpec(r.body, pkg)
      const next = [...parsed.items, ...saved]
      setSaved(next)
      saveList(next)
      const origin = /^(https?:\/\/[^/]+)/i.exec(u)?.[1]
      const mergedVars = {
        ...envVars,
        ...(origin && !envVars.baseUrl ? { baseUrl: origin } : {}),
        ...parsed.vars
      }
      setEnvVars(mergedVars)
      saveEnv(mergedVars)
      if (parsed.items[0]) {
        setReq(parsed.items[0].req)
        setActiveCall(null)
        setActiveApi(undefined)
        setRes(null)
      }
      setSideTab('saved')
      setShowSidebar(true)
      setShowSwaggerBox(false)
      flash(`Đã nạp ${parsed.items.length} API từ Swagger "${parsed.name}"`)
    } catch (e) {
      flash(`Lỗi đọc Swagger JSON: ${(e as Error).message}`)
    } finally {
      setLoadingSwagger(false)
    }
  }

  // Select an API from the SRS Requirement Document (works even when FE is dead!)
  const selectDocApi = (docApi: ReqApi, preferDocTemplate = false): void => {
    setActiveApi(docApi)
    const fm = currentDoc
      ? (() => {
          try {
            const raw = localStorage.getItem(`reqFields:${currentDoc.id}:${docApi.id}`)
            return raw ? (JSON.parse(raw) as FieldMap) : {}
          } catch {
            return {}
          }
        })()
      : {}
    setActiveFieldMap(fm)
    setRuns(new Map())
    setRes(null)

    if (!preferDocTemplate && calls.length > 0 && currentDoc) {
      const savedPath = localStorage.getItem(`reqPath:${currentDoc.id}:${docApi.id}`) || suggestPath(docApi, calls)
      if (savedPath) {
        const hit = [...apiCalls(calls)].reverse().find((c) => pathOf(c.url).toLowerCase().includes(savedPath.toLowerCase()))
        if (hit) {
          setActiveCall(hit)
          setReq(requestFromCall(hit))
          flash(`Đã nạp "${shortApi(docApi.name)}" từ gói tin thực tế bắt trên máy`)
          return
        }
      }
    }

    setActiveCall(null)
    const base = envVars.baseUrl || liveVars.baseUrl || '{{baseUrl}}'
    const built = requestFromDocApi(docApi, base, fm)
    setReq(built)
    setReqTab(/^(GET|HEAD)$/i.test(built.method) ? 'query' : 'body')
    flash(`Đã dựng khung Request & dữ liệu mẫu cho "${shortApi(docApi.name)}" trực tiếp từ Tài liệu SRS (không cần FE)`)
  }

  const createNewBlankApi = (): void => {
    const base = envVars.baseUrl || liveVars.baseUrl || '{{baseUrl}}'
    setActiveCall(null)
    setActiveApi(undefined)
    setRes(null)
    setRuns(new Map())
    setReq({
      method: 'POST',
      url: `${base}/api/v1/endpoint`,
      headers: [
        { name: 'Content-Type', value: 'application/json', enabled: true },
        { name: 'Authorization', value: 'Bearer {{token}}', enabled: true }
      ],
      body: '{\n  \n}'
    })
  }

  const sendNow = async (targetReq = req): Promise<void> => {
    if (!targetReq.url.trim()) return flash('Chưa nhập URL')
    if (targetReq.url.includes('{{baseUrl}}') && !envVars.baseUrl && !liveVars.baseUrl) {
      return flash('URL đang dùng {{baseUrl}} — hãy điền địa chỉ Server (VD: https://uat-api.domain.vn) vào ô Base URL ở thanh trên trước!')
    }
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
        setActiveCall(null)
        setActiveApi(undefined)
        setRes(null)
      }
      setSideTab('saved')
      setShowSidebar(true)
      flash(`Đã nhập ${r.items.length} API từ "${r.name}"`)
    } catch (e) {
      flash(`Không nhập được file: ${(e as Error).message}`)
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
      flash('Chưa thấy Token nào từ điện thoại (FE chưa gọi API?). Bạn có thể bấm "Đăng nhập Server" bên cạnh để lấy Token trực tiếp từ Backend!')
      return
    }
    setReq(next)
    flash(`Đã đồng bộ ${updated.join(', ')} mới nhất từ điện thoại`)
  }

  const copyCurl = async (): Promise<void> => {
    const cmd = toCurl(resolveEnvVars(req, envVars, calls))
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
      setActiveCall(null)
      setRes(null)
      flash(`Đã nhập cURL: ${parsed.method} ${pathOf(parsed.url)}`)
    } catch (e) {
      flash(`Không đọc được clipboard: ${(e as Error).message}`)
    }
  }

  const saveCurrent = (): void => {
    const label = activeApi?.name ? shortApi(activeApi.name) : `${req.method} ${pathOf(req.url)}`
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
    if (resolvedBaseReq.url.includes('{{baseUrl}}')) {
      return flash('URL đang chứa {{baseUrl}} chưa có giá trị — hãy nhập Base URL ở thanh trên trước khi chạy bộ test!')
    }
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
    if (!list.length) return flash('Hãy bấm "Chạy kịch bản" trước khi xuất KBKT')
    localStorage.setItem('reqTpl', tpl)
    localStorage.setItem('apiKbktCode', code)
    localStorage.setItem('reqAuthor', author)
    setExporting(true)
    try {
      const title = activeApi?.name || `Kiểm thử API ${req.method} ${pathOf(req.url)}`
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

  const filteredSaved = useMemo(() => {
    const q = sideSearch.trim().toLowerCase()
    if (!q) return saved
    return saved.filter((s) => s.name.toLowerCase().includes(q) || s.req.url.toLowerCase().includes(q))
  }, [saved, sideSearch])

  const filteredDocApis = useMemo(() => {
    const list = currentDoc?.apis ?? []
    const q = sideSearch.trim().toLowerCase()
    if (!q) return list
    return list.filter((a) => a.name.toLowerCase().includes(q) || (a.url ?? '').toLowerCase().includes(q))
  }, [currentDoc, sideSearch])

  const filteredLiveCalls = useMemo(() => {
    const q = sideSearch.trim().toLowerCase()
    if (!q) return httpCalls
    return httpCalls.filter((c) => c.url.toLowerCase().includes(q) || c.method.toLowerCase().includes(q))
  }, [httpCalls, sideSearch])

  const effectiveToken = envVars.token || liveVars.token || ''

  return (
    <div className="apilab-backdrop" onClick={onClose}>
      <div className="apilab-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="apilab-head">
          <button
            className={`iconbtn ${showSidebar ? 'on' : ''}`}
            onClick={() => setShowSidebar((v) => !v)}
            title="Đóng / mở cột danh sách API (Sổ tay, Tài liệu SRS, Gói tin từ máy)"
          >
            {showSidebar ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            <span>Danh sách API</span>
          </button>
          <FlaskConical size={16} className="apilab-ico" />
          <b>API Studio (Bắt theo FE &amp; Độc lập)</b>
          {activeApi && <span className="mini-tag">{shortApi(activeApi.name)}</span>}
          {activeCall ? (
            <span className="mini-tag" title="Đang lấy dữ liệu từ gói tin bắt trên điện thoại">
              {activeCall.source === 'chucker' ? 'Gói tin Chucker' : 'Gói tin từ máy (FE)'}
            </span>
          ) : (
            <span className="mini-tag muted-tag" title="Chạy độc lập hoàn toàn, không phụ thuộc giao diện FE">
              Chế độ Độc lập
            </span>
          )}
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
          {/* Quick Base URL & Token status right in header */}
          <label className="field-inline" title="Địa chỉ máy chủ gốc {{baseUrl}} dùng cho các API độc lập / Tài liệu SRS">
            <Globe size={13} className="muted" />
            <span>Base URL:</span>
            <input
              className="input sm mono"
              style={{ width: 210 }}
              placeholder={liveVars.baseUrl || 'https://uat-api.domain.vn'}
              value={envVars.baseUrl ?? ''}
              onChange={(e) => updateEnvVar('baseUrl', e.target.value)}
            />
          </label>
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
            placeholder="https://api.example.com/v1/... hoặc {{baseUrl}}/api/..."
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
            <button
              className="iconbtn primary"
              disabled={runningSuite}
              onClick={() => void runSuite()}
              title="Tự động bắn toàn bộ kịch bản kiểm thử đầu vào & bảo mật"
            >
              {runningSuite ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Chạy {probes.length} kịch bản
            </button>
          )}
          <button
            className="iconbtn"
            onClick={syncToken}
            title="Chế độ 1 (Khi FE sống): Lấy Authorization / Cookie mới nhất vừa bắt được từ điện thoại"
          >
            <Smartphone size={13} /> Token từ máy
          </button>
          <button
            className={`iconbtn ${showAuthBox ? 'on' : ''}`}
            onClick={() => {
              setShowAuthBox((v) => !v)
              setShowSwaggerBox(false)
            }}
            title="Chế độ 2 (Khi FE chết): Gọi thẳng API Login của Backend để tự lấy Token nạp vào {{token}}"
          >
            <KeyRound size={13} /> Đăng nhập Server {effectiveToken ? '✓' : ''}
          </button>
          <button className="iconbtn" onClick={() => void copyCurl()} title="Copy lệnh cURL (đã thay biến) để gửi cho Dev Backend">
            <ClipboardCopy size={13} /> Copy cURL
          </button>
          <button className="iconbtn" onClick={() => void pasteCurl()} title="Dán lệnh cURL từ clipboard vào đây">
            <ClipboardPaste size={13} /> Dán cURL
          </button>
          <button className="iconbtn" onClick={saveCurrent} title="Lưu API này vào sổ tay để dùng lại khi FE chết">
            <Bookmark size={13} /> Lưu
          </button>
          <button
            className="iconbtn"
            onClick={() => addReqToAutoScript(req, res?.status && res.status >= 200 && res.status < 300 ? res.status : 0)}
            title="Thêm bước 'Bắn API lên Server' với cấu hình này vào tab Tự động test"
          >
            <ListPlus size={13} /> + Kịch bản
          </button>
        </div>

        {/* Direct Server Auth Box (For when FE is dead / Login UI broken) */}
        {showAuthBox && (
          <div className="apilab-authbox">
            <div className="apilab-authbox-head">
              <ShieldCheck size={15} className="apilab-ico" />
              <b>Đăng nhập trực tiếp Backend để lấy Token (Không cần qua FE)</b>
              <span className="muted">
                Gọi thẳng API Login của Server, tự bóc <code>accessToken</code> / <code>token</code> nạp vào <code>{'{{token}}'}</code>
              </span>
              <span className="spacer" />
              <button
                className="iconbtn"
                onClick={() => {
                  const next = { ...authCfg, method: req.method, url: req.url, body: req.body }
                  setAuthCfg(next)
                  saveAuthConfig(next)
                  flash('Đã lấy URL & Body đang mở làm cấu hình API Login')
                }}
                title="Dùng chính request đang mở bên dưới làm API Login"
              >
                Lấy từ request đang mở
              </button>
              <button className="iconbtn ghost" onClick={() => setShowAuthBox(false)}>
                <X size={13} />
              </button>
            </div>
            <div className="step-f-row">
              <select
                className="input sm mono"
                value={authCfg.method}
                onChange={(e) => setAuthCfg({ ...authCfg, method: e.target.value })}
              >
                {['POST', 'GET', 'PUT'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                className="input sm grow mono"
                placeholder="URL API Login: https://... hoặc {{baseUrl}}/api/v1/auth/login"
                value={authCfg.url}
                onChange={(e) => setAuthCfg({ ...authCfg, url: e.target.value })}
              />
              <input
                className="input sm mono"
                style={{ width: 210 }}
                placeholder="Trường token (để trống = tự dò)"
                title="Đường dẫn trường JSON chứa token (VD: data.accessToken, result.token). Để trống công cụ sẽ tự dò."
                value={authCfg.tokenPath}
                onChange={(e) => setAuthCfg({ ...authCfg, tokenPath: e.target.value })}
              />
              <button className="iconbtn primary" disabled={loggingIn} onClick={() => void loginDirectToServer()}>
                {loggingIn ? <Loader2 size={13} className="spin" /> : <KeyRound size={13} />} Gọi Login &amp; Nạp {'{{token}}'}
              </button>
            </div>
            <textarea
              className="input mono step-f-textarea"
              rows={3}
              placeholder={'{\n  "username": "0987654321",\n  "password": "secret"\n}'}
              value={authCfg.body}
              onChange={(e) => setAuthCfg({ ...authCfg, body: e.target.value })}
              spellCheck={false}
            />
          </div>
        )}

        {/* Swagger URL Box */}
        {showSwaggerBox && (
          <div className="apilab-authbox">
            <div className="step-f-row">
              <Globe size={14} className="apilab-ico" />
              <b>Nạp danh sách API từ đường dẫn Swagger / OpenAPI JSON:</b>
              <input
                className="input sm grow mono"
                placeholder="VD: https://uat-api.domain.vn/v3/api-docs hoặc https://.../swagger.json"
                value={swaggerUrl}
                onChange={(e) => setSwaggerUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void fetchSwaggerFromUrl()}
              />
              <button className="iconbtn primary" disabled={loadingSwagger} onClick={() => void fetchSwaggerFromUrl()}>
                {loadingSwagger ? <Loader2 size={13} className="spin" /> : <Download size={13} />} Tải Swagger
              </button>
              <button className="iconbtn ghost" onClick={() => setShowSwaggerBox(false)}>
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="apilab-notice">
            <span>{notice}</span>
            <button className="iconbtn ghost" onClick={() => setNotice('')}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* Main Workspace: Left Sidebar + Right Active Area */}
        <div className="apilab-body">
          {showSidebar && (
            <div className="apilab-sidebar">
              <div className="apilab-side-tabs">
                <button
                  className={`apilab-side-tab ${sideTab === 'saved' ? 'on' : ''}`}
                  onClick={() => setSideTab('saved')}
                  title="Các API tự tạo, lưu lại hoặc nhập từ Postman / Swagger"
                >
                  <Bookmark size={12} /> Sổ tay ({saved.length})
                </button>
                <button
                  className={`apilab-side-tab ${sideTab === 'doc' ? 'on' : ''}`}
                  onClick={() => setSideTab('doc')}
                  title="Dựng sẵn API & Body mẫu trực tiếp từ Tài liệu SRS (.docx) ngay cả khi FE chết"
                >
                  <FileText size={12} /> Tài liệu ({currentDoc?.apis.length ?? 0})
                </button>
                <button
                  className={`apilab-side-tab ${sideTab === 'live' ? 'on' : ''}`}
                  onClick={() => setSideTab('live')}
                  title="Các gói tin thực tế vừa bắt được từ điện thoại"
                >
                  <Smartphone size={12} /> Từ máy ({httpCalls.length})
                </button>
              </div>

              <div className="apilab-side-tools">
                <input
                  className="input sm grow"
                  style={{ minWidth: 100 }}
                  placeholder="Tìm tên hoặc đường dẫn API…"
                  value={sideSearch}
                  onChange={(e) => setSideSearch(e.target.value)}
                />
                {sideTab === 'saved' && (
                  <button className="iconbtn" onClick={createNewBlankApi} title="Tạo một request API mới độc lập">
                    <Plus size={13} /> Mới
                  </button>
                )}
              </div>

              {sideTab === 'saved' && (
                <>
                  <div className="apilab-side-actions">
                    <button className="iconbtn sm-btn" onClick={() => void importPostman()} title="Nhập file Postman Collection hoặc Swagger / OpenAPI (.json)">
                      <Upload size={12} /> File Postman / Swagger
                    </button>
                    <button
                      className="iconbtn sm-btn"
                      onClick={() => {
                        setShowSwaggerBox((v) => !v)
                        setShowAuthBox(false)
                      }}
                      title="Tải trực tiếp danh sách API từ link Swagger / OpenAPI của Backend"
                    >
                      <Globe size={12} /> Link Swagger
                    </button>
                    <button className="iconbtn sm-btn" onClick={() => void exportPostman()} title="Xuất danh sách ra file Postman Collection">
                      <Download size={12} /> Xuất
                    </button>
                  </div>
                  <div className="apilab-side-list">
                    {filteredSaved.length === 0 && (
                      <div className="muted" style={{ padding: 14, fontSize: 12, lineHeight: 1.5 }}>
                        Chưa có API nào trong sổ tay. Bấm <b>+ Mới</b>, <b>File Postman / Swagger</b>, <b>Link Swagger</b> hoặc chuyển sang tab <b>Tài liệu</b> để lấy từ file SRS.
                      </div>
                    )}
                    {filteredSaved.map((it) => (
                      <div
                        key={it.id}
                        className={`apilab-side-item ${req.url === it.req.url && req.method === it.req.method ? 'sel' : ''}`}
                        onClick={() => {
                          setReq(it.req)
                          setActiveCall(null)
                          setActiveApi(undefined)
                          setRes(null)
                          setRuns(new Map())
                        }}
                      >
                        <span className={`apilab-mbadge m-${it.req.method.toLowerCase()}`}>{it.req.method}</span>
                        <div className="apilab-side-text">
                          <div className="apilab-side-name">{it.name}</div>
                          <div className="apilab-side-sub mono">{pathOf(it.req.url)}</div>
                        </div>
                        <button
                          className="iconbtn ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteSaved(it.id)
                          }}
                          title="Xoá khỏi sổ tay"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {sideTab === 'doc' && (
                <>
                  {docList.length > 1 && (
                    <div className="apilab-side-actions">
                      <select className="input sm grow" value={selDocId} onChange={(e) => setSelDocId(e.target.value)}>
                        {docList.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title || d.file} ({d.apis} API)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="apilab-side-list">
                    {!currentDoc && (
                      <div className="muted" style={{ padding: 14, fontSize: 12, lineHeight: 1.5 }}>
                        Chưa có tài liệu SRS (.docx) nào được nạp. Hãy mở mục <b>Tài liệu YC</b> để tải file thiết kế BA lên một lần — toàn bộ đặc tả API sẽ hiện ở đây để test độc lập kể cả khi FE chết.
                      </div>
                    )}
                    {filteredDocApis.map((da) => (
                      <div
                        key={da.id}
                        className={`apilab-side-item ${activeApi?.id === da.id ? 'sel' : ''}`}
                        onClick={() => selectDocApi(da, true)}
                        title={`${da.name}\nBấm để tự dựng khung Request & dữ liệu mẫu theo bảng đặc tả tài liệu`}
                      >
                        <span className={`apilab-mbadge m-${(da.method || 'post').toLowerCase()}`}>{da.method || 'API'}</span>
                        <div className="apilab-side-text">
                          <div className="apilab-side-name">{shortApi(da.name)}</div>
                          <div className="apilab-side-sub mono">{da.url || `${da.inputs.length} tham số đầu vào`}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {sideTab === 'live' && (
                <div className="apilab-side-list">
                  {filteredLiveCalls.length === 0 && (
                    <div className="muted" style={{ padding: 14, fontSize: 12, lineHeight: 1.5 }}>
                      Chưa bắt được gói tin nào từ điện thoại. Nếu FE đang lỗi hoặc chưa có UI, hãy chuyển sang tab <b>Sổ tay</b> hoặc <b>Tài liệu</b> để test độc lập!
                    </div>
                  )}
                  {filteredLiveCalls.map((c) => (
                    <div
                      key={c.id}
                      className={`apilab-side-item ${activeCall?.id === c.id ? 'sel' : ''}`}
                      onClick={() => {
                        setActiveCall(c)
                        setReq(requestFromCall(c))
                        setRes(null)
                        setRuns(new Map())
                      }}
                    >
                      <span className={`apilab-mbadge m-${c.method.toLowerCase()}`}>{c.method}</span>
                      <div className="apilab-side-text">
                        <div className="apilab-side-name mono">{pathOf(c.url)}</div>
                        <div className="apilab-side-sub muted">
                          HTTP {c.status ?? '…'} · {c.durationMs ?? '?'} ms {c.source === 'chucker' ? '· Chucker' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                  <button
                    className={`apilab-subtab ${reqTab === 'env' ? 'on' : ''}`}
                    onClick={() => setReqTab('env')}
                    title="Biến môi trường {{token}}, {{baseUrl}}…"
                  >
                    Biến {'{{…}}'} ({Object.keys(liveVars).length + Object.keys(envVars).length})
                  </button>
                  <span className="spacer" />
                  {activeApi && (
                    <button
                      className="iconbtn ghost"
                      onClick={() => selectDocApi(activeApi, true)}
                      title="Tạo lại khung Body JSON mẫu theo đúng bảng đặc tả trong Tài liệu SRS"
                    >
                      <FileText size={12} /> Dựng mẫu từ SRS
                    </button>
                  )}
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
                    placeholder={
                      /^(GET|HEAD)$/i.test(req.method)
                        ? 'Request GET/HEAD thường không gửi kèm Body (chuyển sang tab Query để sửa tham số trên URL)'
                        : '{\n  "key": "value"\n}'
                    }
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
                      Dùng cú pháp <code>{'{{token}}'}</code>, <code>{'{{baseUrl}}'}</code> hoặc tên biến bất kỳ trong URL, Header, Body. Các biến bạn tự đặt hoặc lấy từ <b>Đăng nhập Server</b> sẽ được ưu tiên hơn biến bắt từ máy.
                    </div>
                    {Object.entries(liveVars).map(([k, v]) => (
                      <div key={`live:${k}`} className="apilab-kv-row">
                        <span className="mini-tag">Từ máy (FE)</span>
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
                      {resLeaves.length > 0 && (
                        <button
                          className={`apilab-subtab ${resView === 'vars' ? 'on' : ''}`}
                          onClick={() => setResView('vars')}
                          title="Lưu các giá trị trả về (token, orderId, id…) vào biến {{…}} để truyền sang API tiếp theo"
                        >
                          Trích xuất biến ({resLeaves.length})
                        </button>
                      )}
                      {activeCall?.result && (
                        <button className={`apilab-subtab ${resView === 'diff' ? 'on' : ''}`} onClick={() => setResView('diff')}>
                          So với gốc trên máy
                        </button>
                      )}
                    </>
                  )}
                </div>

                {!res && !sending && (
                  <div className="apilab-empty muted">
                    <div>
                      Chỉnh sửa tham số bên trái rồi bấm <b>Gửi thử</b> để xem Server trả về gì.
                      <br />
                      • Nếu <b>FE đang sống</b>: bấm <b>Token từ máy</b> hoặc chọn gói tin ở cột <b>Từ máy</b>.
                      <br />• Nếu <b>FE đang chết / chưa có UI</b>: nhập <b>Base URL</b> ở góc trên, bấm <b>Đăng nhập Server</b> để lấy Token trực tiếp, và chọn API từ <b>Tài liệu</b> hoặc <b>Sổ tay / Swagger</b>!
                    </div>
                    {activeCall?.result && (
                      <div className="apilab-orig-preview">
                        <div className="panel-title">Phản hồi gốc bắt từ điện thoại (HTTP {activeCall.status ?? '?'})</div>
                        <pre className="mono">{prettyJson(activeCall.result)}</pre>
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

                {res && !sending && resView === 'vars' && (
                  <div className="apilab-kv-list">
                    <div className="muted" style={{ padding: '6px 10px', fontSize: 12 }}>
                      Bấm <b>Lưu vào biến</b> ở bất kỳ trường nào trong kết quả trả về để dùng cho các API tiếp theo (nối luồng API 1 → API 2 không cần FE):
                    </div>
                    {resLeaves.map((lf) => (
                      <div key={lf.path} className="apilab-kv-row">
                        <code className="mono" style={{ minWidth: 160 }}>{lf.path}</code>
                        <input className="input sm mono grow" value={lf.value} readOnly />
                        <button
                          className="iconbtn"
                          onClick={() => {
                            updateEnvVar(lf.shortKey, lf.value)
                            flash(`Đã lưu ${lf.path} vào biến {{${lf.shortKey}}} = "${lf.value.slice(0, 40)}"`)
                          }}
                        >
                          <Plus size={12} /> Lưu {'{{'}
                          {lf.shortKey}
                          {'}}'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {res && !sending && resView === 'diff' && activeCall?.result && (
                  <div className="apilab-diff">
                    <div>
                      <div className="panel-title">Bản gốc trên máy (HTTP {activeCall.status ?? '?'})</div>
                      <pre className="apilab-pre mono">{prettyJson(activeCall.result)}</pre>
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
                <button
                  className="iconbtn"
                  disabled={!runs.size || exporting}
                  onClick={() => void exportKbkt()}
                  title="Xuất toàn bộ kịch bản và kết quả Pass/Fail ra file Excel KBKT"
                >
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
                            selectedRun?.res.status ??
                              (selectedProbe.expect === 'ok' ? 200 : selectedProbe.expect === 'auth_err' ? 401 : 400)
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
                      <div className="panel-title">
                        Request gửi đi ({selectedProbe.req.method} {pathOf(selectedProbe.req.url)})
                      </div>
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
    </div>
  )
}
