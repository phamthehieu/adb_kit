import { adb, shell } from './adb'
import { pidsOf } from './services'
import { TAURI_HOOK_SCRIPT, TAURI_MARK } from './tauriHook'
import { CAP_HOOK_SCRIPT, CAP_MARK } from './bridgeHook'
import type { MockRule, NetCall, NetProfile, WebError } from '../shared/automation'

type Found = Omit<WebError, 'step' | 'iteration'>

interface CdpMessage {
  id?: number
  method?: string
  params?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  result?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface InspectorHandlers {
  onError?: (e: Found) => void
  /** Called whenever a call is created or updated (same id = update). */
  onCall?: (c: NetCall) => void
  onInfo?: (msg: string) => void
}

export interface InspectorOptions {
  errors: boolean
  network: boolean
  /**
   * Inject bridge hooks: Tauri (JS → Rust commands) and Capacitor / WindVane mini-app
   * containers (JS → native plugin calls, incl. WVFetch HTTP).
   */
  bridge: boolean
}

const shorten = (url = ''): string => url.replace(/^https?:\/\/[^/]+/, '') || url
const clip = (s: string | undefined, n = 4000): string | undefined =>
  s === undefined ? undefined : s.length > n ? `${s.slice(0, n)}…(${s.length} ký tự)` : s
/** The app's own bundled files are not "API calls". */
const LOCAL_HOST = /^(https?:\/\/(tauri\.localhost|localhost|appassets\.androidplatform\.net|127\.0\.0\.1)(:\d+)?\/|file:|data:|blob:|capacitor:|ionic:)/
const API_TYPES = new Set(['Fetch', 'XHR', 'EventSource', 'WebSocket', 'Document', 'Ping'])
/** Short name of a page for the call list: its title, else host + path. */
const pageLabel = (title = '', url = ''): string =>
  title && !/^https?:|^about:/.test(title) ? title : url.replace(/^https?:\/\//, '').split('?')[0].slice(0, 60)

/**
 * Attaches to an app's WebView through its DevTools socket
 * (`webview_devtools_remote_<pid>`, available for debuggable apps) and reports:
 *  - uncaught JS exceptions, console.error / console.assert, browser errors;
 *  - HTTP requests made by the page (fetch / XHR / …) with status, timing and bodies;
 *  - for Tauri apps, every command sent from JS to Rust (incl. SQL / HTTP plugin calls).
 * Re-attaches automatically when the app restarts.
 */
export class WebViewInspector {
  private sockets = new Map<string, { ws: WebSocket; send: (m: string, p?: object) => Promise<CdpMessage>; title: string }>()
  /** DevTools socket name (one per WebView process) → forwarded local port. */
  private ports = new Map<string, number>()
  private lastScan = 0
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private toldMissing = false
  private http = new Map<string, NetCall>()
  private ipc = new Map<string, NetCall>()
  /** Tauri http plugin: ipc call id → synthesized HTTP call id, and resource id → HTTP call id. */
  private httpByIpc = new Map<string, string>()
  private httpByRid = new Map<number, string>()
  private mocks: MockRule[] = []
  /** Per page: id of the new-document script that re-installs the mocks after a reload. */
  private mockScriptIds = new Map<string, string>()
  /** Network request ids whose outcome a mock decided (to flag the call). */
  private mockedIds = new Map<string, string>()

  /**
   * Install fake behaviour. HTTP from the WebView is intercepted with DevTools' Fetch domain;
   * Tauri commands are answered by the IPC hook (window.__adbkitMocks, auto-expiring).
   */
  async setMocks(rules: MockRule[]): Promise<void> {
    this.mocks = rules
    for (const [pageId, s] of this.sockets) await this.applyMocks(pageId, s.send)
  }

  /** Bad-network profile for every API call (null = normal network). */
  private profile: NetProfile | null = null
  async setProfile(p: NetProfile | null): Promise<void> {
    this.profile = p
    for (const [pageId, s] of this.sockets) await this.applyMocks(pageId, s.send)
  }

  private async applyMocks(pageId: string, send: (m: string, p?: object) => Promise<CdpMessage>): Promise<void> {
    const ttl = 'Date.now() + 15 * 60 * 1000'
    const assign =
      `window.__adbkitMocks = ${JSON.stringify({ rules: this.mocks })}; window.__adbkitMocks.expires = ${ttl};` +
      `window.__adbkitNet = ${JSON.stringify(this.profile)}; if (window.__adbkitNet) window.__adbkitNet.expires = ${ttl};`
    await send('Runtime.evaluate', { expression: assign })
    const prev = this.mockScriptIds.get(pageId)
    if (prev) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: prev })
    this.mockScriptIds.delete(pageId)
    if (this.mocks.length || this.profile) {
      const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: assign })
      if (r.result?.identifier) this.mockScriptIds.set(pageId, r.result.identifier)
    }
    const http = this.mocks.some((m) => m.kind !== 'ipc')
    // A network profile only touches API calls (fetch / XHR), never the page's own files.
    if (http) await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
    else if (this.profile)
      await send('Fetch.enable', {
        patterns: [
          { urlPattern: '*', resourceType: 'XHR', requestStage: 'Request' },
          { urlPattern: '*', resourceType: 'Fetch', requestStage: 'Request' }
        ]
      })
    else await send('Fetch.disable')
  }

  /** What the network profile does to one API call: undefined = let it through. */
  private profileAction(): { action: 'error' | 'delay'; delayMs?: number } | undefined {
    const p = this.profile
    if (!p) return undefined
    if (p.mode === 'offline') return { action: 'error' }
    if (p.mode === 'flaky' && Math.random() < p.failRate) return { action: 'error' }
    const delayMs = p.mode === 'slow' ? p.delayMs * (0.7 + Math.random() * 0.6) : Math.random() * p.delayMs
    return { action: 'delay', delayMs: Math.round(delayMs) }
  }

  private onPaused(pageId: string, p: Record<string, any>, send: (m: string, p?: object) => Promise<CdpMessage>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    const url = String(p.request.url)
    const local = LOCAL_HOST.test(url) || /ipc\.localhost/.test(url)
    let rule: Pick<MockRule, 'action' | 'delayMs' | 'status' | 'body'> | undefined = local
      ? undefined
      : this.mocks.find((m) => m.kind !== 'ipc' && m.match && url.toLowerCase().includes(m.match.toLowerCase()))
    let label: string | undefined = rule?.action
    if (!rule && !local && (p.resourceType === 'XHR' || p.resourceType === 'Fetch')) {
      rule = this.profileAction()
      if (rule) label = `mạng ${this.profile!.mode === 'slow' ? 'chậm' : this.profile!.mode === 'flaky' ? 'chập chờn' : 'mất'}`
    }
    if (!rule) {
      void send('Fetch.continueRequest', { requestId: p.requestId })
      return
    }
    if (p.networkId) {
      const id = `${pageId}:${p.networkId}`
      this.mockedIds.set(id, label ?? rule.action)
      const c = this.http.get(id)
      if (c) c.mocked = label ?? rule.action
    }
    if (rule.action === 'delay') {
      setTimeout(() => void send('Fetch.continueRequest', { requestId: p.requestId }), rule.delayMs ?? 0)
    } else if (rule.action === 'error') {
      void send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' })
    } else {
      void send('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: rule.status ?? 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json; charset=utf-8' },
          { name: 'Access-Control-Allow-Origin', value: '*' }
        ],
        body: Buffer.from(rule.body ?? '', 'utf8').toString('base64')
      })
    }
  }

  constructor(
    private readonly serial: string,
    private readonly pkg: string,
    /** Run start on the DEVICE clock (ms since epoch); older console/exception events are replays. */
    private readonly since: number,
    private readonly h: InspectorHandlers,
    private readonly opts: InspectorOptions
  ) {}

  get connected(): boolean {
    return this.sockets.size > 0
  }

  start(): void {
    void this.tick()
    // Poll quickly while detached so a freshly launched app is caught near its start.
    this.timer = setInterval(() => void this.tick(), 500)
  }

  private ticking = false

  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return
    // Once attached keep looking, more slowly, for new pages: a super-app opens each
    // mini-app in a new WebView (often the same process, sometimes another one).
    if (this.sockets.size && Date.now() - this.lastScan < 1500) return
    this.lastScan = Date.now()
    this.ticking = true
    try {
      await this.tickInner()
    } finally {
      this.ticking = false
    }
  }

  private async tickInner(): Promise<void> {
    try {
      const pids = await pidsOf(this.serial, this.pkg)
      if (!pids.length) return
      const unix = await shell(this.serial, 'cat /proc/net/unix')
      const hits = [...new Set([...unix.stdout.matchAll(/@(webview_devtools_remote_(\d+))/g)].filter((m) => pids.includes(Number(m[2]))).map((m) => m[1]))]
      // Forget sockets of processes that are gone.
      for (const [name, port] of this.ports) {
        if (hits.includes(name)) continue
        this.ports.delete(name)
        await adb(['-s', this.serial, 'forward', '--remove', `tcp:${port}`])
      }
      if (!hits.length) {
        if (!this.toldMissing && !this.sockets.size) {
          this.toldMissing = true
          this.h.onInfo?.('Không thấy cổng DevTools của WebView (app cần build debug) — không bắt được lỗi JS / API')
        }
        return
      }
      for (const name of hits) await this.attach(name).catch(() => {})
    } catch {
      /* try again next tick */
    }
  }

  private async attach(socketName: string): Promise<void> {
    let port = this.ports.get(socketName)
    if (!port) {
      const f = await adb(['-s', this.serial, 'forward', 'tcp:0', `localabstract:${socketName}`])
      port = parseInt(f.stdout.trim(), 10)
      if (!port) return
      this.ports.set(socketName, port)
    }
    if (this.stopped) return
    const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })
    const pages = ((await res.json()) as { id: string; type: string; url: string; title?: string; webSocketDebuggerUrl?: string }[]).filter(
      (p) => p.type === 'page' && p.webSocketDebuggerUrl
    )
    for (const p of pages) {
      const s = this.sockets.get(p.id)
      if (s) s.title = pageLabel(p.title, p.url)
      else this.connect(p.id, p.webSocketDebuggerUrl!, p.url, pageLabel(p.title, p.url))
    }
  }

  private connect(pageId: string, wsUrl: string, pageUrl: string, title: string): void {
    const ws = new WebSocket(wsUrl)
    let seq = 0
    const waiting = new Map<number, (m: CdpMessage) => void>()
    const send = (method: string, params: object = {}): Promise<CdpMessage> =>
      new Promise((resolve) => {
        const id = ++seq
        waiting.set(id, resolve)
        ws.send(JSON.stringify({ id, method, params }))
        setTimeout(() => {
          if (waiting.delete(id)) resolve({})
        }, 10_000)
      })
    this.sockets.set(pageId, { ws, send, title })

    ws.addEventListener('open', () => {
      this.toldMissing = true
      void (async () => {
        await send('Runtime.enable')
        if (this.opts.errors) await send('Log.enable')
        if (this.opts.network) await send('Network.enable', { maxPostDataSize: 65536 })
        let kind = ''
        if (this.opts.bridge) {
          const r = await send('Runtime.evaluate', {
            expression: "window.__TAURI_INTERNALS__ ? 'tauri' : (window.capacitorNative || window.Capacitor) ? 'cap' : ''",
            returnByValue: true
          })
          kind = String(r.result?.result?.value ?? '')
          await send('Page.enable')
          if (kind === 'tauri') {
            await send('Page.addScriptToEvaluateOnNewDocument', { source: TAURI_HOOK_SCRIPT })
            await send('Runtime.evaluate', { expression: TAURI_HOOK_SCRIPT })
          } else {
            // The page may still be loading (mini-app containers create the WebView first):
            // the Capacitor hook waits briefly for the bridge and gives up harmlessly otherwise.
            await send('Page.addScriptToEvaluateOnNewDocument', { source: CAP_HOOK_SCRIPT })
            await send('Runtime.evaluate', { expression: CAP_HOOK_SCRIPT })
          }
        }
        if (this.mocks.length) await this.applyMocks(pageId, send)
        const what = kind === 'tauri' ? ' (app Tauri — theo dõi cả lệnh JS → Rust)' : kind === 'cap' ? ' (miniapp — theo dõi cả lệnh gọi bridge)' : ''
        this.h.onInfo?.(`Đã kết nối WebView: ${title || pageUrl}${what}`)
      })()
    })
    ws.addEventListener('message', (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as CdpMessage
        if (m.id !== undefined) {
          waiting.get(m.id)?.(m)
          waiting.delete(m.id)
        } else this.handle(m, pageId, send)
      } catch {
        /* ignore malformed */
      }
    })
    const drop = (): void => {
      if (this.sockets.get(pageId)?.ws === ws) this.sockets.delete(pageId)
    }
    ws.addEventListener('close', drop)
    ws.addEventListener('error', drop)
  }

  /** Reload the app's page (= restart its UI) so calls made at startup are captured too. */
  async reload(): Promise<boolean> {
    let any = false
    for (const s of this.sockets.values()) {
      await s.send('Page.reload')
      any = true
    }
    return any
  }

  /* ---------------------------------------------------------------- events */

  /**
   * `deviceTs` is the event's own timestamp (device clock): anything older than the start is
   * a replay of a past message and is dropped. `at` uses the PC clock to line up with steps.
   */
  private error(e: Omit<Found, 'at'>, deviceTs?: number): void {
    if (!this.opts.errors) return
    if (typeof deviceTs === 'number' && deviceTs < this.since) return
    this.h.onError?.({ ...e, at: Date.now() })
  }

  private emitCall(c: NetCall): void {
    this.h.onCall?.({ ...c })
  }

  private handle(m: CdpMessage, pageId: string, send: (m: string, p?: object) => Promise<CdpMessage>): void {
    const p = m.params
    if (!p) return
    switch (m.method) {
      case 'Fetch.requestPaused':
        this.onPaused(pageId, p, send)
        break
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails
        const frames: { functionName: string; url: string; lineNumber: number; columnNumber: number }[] = d.stackTrace?.callFrames ?? []
        const stack =
          d.exception?.description ??
          frames.map((f) => `    at ${f.functionName || '(anonymous)'} (${shorten(f.url)}:${f.lineNumber + 1}:${f.columnNumber + 1})`).join('\n')
        this.error(
          {
            kind: 'exception',
            message: (d.exception?.description as string | undefined)?.split('\n')[0] ?? d.text,
            source: d.url ? `${shorten(d.url)}:${(d.lineNumber ?? 0) + 1}` : undefined,
            stack
          },
          p.timestamp
        )
        break
      }
      case 'Runtime.consoleAPICalled': {
        const first = p.args?.[0]?.value
        if (typeof first === 'string' && first.startsWith(TAURI_MARK)) {
          // Runtime.enable replays old console messages: ignore IPC events from before we started.
          if (typeof p.timestamp === 'number' && p.timestamp < this.since) return
          this.onIpc(pageId, first.slice(TAURI_MARK.length))
          return
        }
        if (typeof first === 'string' && first.startsWith(CAP_MARK)) {
          if (typeof p.timestamp === 'number' && p.timestamp < this.since) return
          this.onCap(pageId, first.slice(CAP_MARK.length))
          return
        }
        if (p.type !== 'error' && p.type !== 'assert') return
        const text = (p.args as { value?: unknown; description?: string; unserializableValue?: string }[])
          .map((a) =>
            a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? a.unserializableValue ?? '')
          )
          .join(' ')
        const top = p.stackTrace?.callFrames?.[0]
        this.error({ kind: 'console', message: `console.${p.type}: ${text}`, source: top ? `${shorten(top.url)}:${top.lineNumber + 1}` : undefined }, p.timestamp)
        break
      }
      case 'Log.entryAdded': {
        const e = p.entry
        if (e.level !== 'error' || e.source === 'network') return // network errors are covered below
        this.error({ kind: 'log', message: e.text, source: e.url ? shorten(e.url) : undefined }, e.timestamp)
        break
      }
      case 'Network.requestWillBeSent': {
        const url: string = p.request.url
        const id = `${pageId}:${p.requestId}`
        const prev = this.http.get(id)
        if (prev && p.redirectResponse) {
          // Same request id after a redirect: close the previous hop.
          prev.status = p.redirectResponse.status
          prev.durationMs = Date.now() - prev.startedAt
          this.emitCall(prev)
        }
        if (LOCAL_HOST.test(url) || /ipc\.localhost/.test(url) || !API_TYPES.has(p.type)) return
        const c: NetCall = {
          id,
          kind: 'http',
          method: p.request.method,
          url,
          args: clip(p.request.postData),
          resourceType: p.type,
          startedAt: Date.now(),
          mocked: this.mockedIds.get(id),
          page: this.sockets.get(pageId)?.title
        }
        this.http.set(id, c)
        this.emitCall(c)
        break
      }
      case 'Network.responseReceived': {
        const c = this.http.get(`${pageId}:${p.requestId}`)
        if (!c) return
        c.status = p.response.status
        c.resourceType = p.type ?? c.resourceType
        ;(c as NetCall & { mime?: string }).mime = p.response.mimeType
        break
      }
      case 'Network.loadingFinished': {
        const id = `${pageId}:${p.requestId}`
        const c = this.http.get(id)
        if (!c) return
        c.durationMs = Date.now() - c.startedAt
        const mime = (c as NetCall & { mime?: string }).mime ?? ''
        if (/json|text|xml|javascript/.test(mime) || c.resourceType === 'Fetch' || c.resourceType === 'XHR') {
          void send('Network.getResponseBody', { requestId: p.requestId }).then((r) => {
            const b = r.result
            if (b && typeof b.body === 'string') c.result = b.base64Encoded ? `[dữ liệu nhị phân ${Math.round((b.body.length * 3) / 4)} byte]` : clip(b.body)
            this.emitCall(c)
          })
        } else this.emitCall(c)
        if (c.status && c.status >= 400) this.error({ kind: 'network', message: `HTTP ${c.status} ${c.url}` })
        break
      }
      case 'Network.loadingFailed': {
        const c = this.http.get(`${pageId}:${p.requestId}`)
        if (!c || p.canceled) return
        c.status = 0
        c.error = p.errorText
        c.durationMs = Date.now() - c.startedAt
        this.emitCall(c)
        this.error({ kind: 'network', message: `${p.errorText} ${c.url}` })
        break
      }
    }
  }

  /**
   * Capacitor / WindVane bridge hook events:
   *  {k:'call', id, cmd, args | http:{method,url,headers,body}, mocked}
   *  {k:'result', id, ok, data | http:{status,headers,body}}
   *  {k:'event', id, cmd, data}   (native → JS notification)
   * WVFetch.request is shown as an HTTP call (the mini-app's API traffic), the rest as commands.
   */
  private bridge = new Map<string, NetCall>()

  private onCap(pageId: string, json: string): void {
    type Http = { method?: string; url?: string; headers?: Record<string, string> | null; body?: string; status?: number }
    let e: { k: string; id: string; cmd?: string; args?: string; data?: string; ok?: boolean; http?: Http; mocked?: string }
    try {
      e = JSON.parse(json)
    } catch {
      return
    }
    const id = `${pageId}:cap${e.id}`
    const page = this.sockets.get(pageId)?.title
    const headers = (h?: Record<string, string> | null): { name: string; value: string }[] | undefined =>
      h ? Object.entries(h).map(([name, value]) => ({ name, value: String(value) })) : undefined
    if (e.k === 'call' && e.cmd) {
      const c: NetCall = e.http
        ? {
            id,
            kind: 'http',
            source: 'bridge',
            method: e.http.method ?? 'GET',
            url: e.http.url ?? '',
            args: e.http.body,
            reqHeaders: headers(e.http.headers),
            resourceType: 'WVFetch',
            startedAt: Date.now(),
            mocked: e.mocked,
            page
          }
        : { id, kind: 'ipc', source: 'bridge', method: 'bridge', url: e.cmd, args: e.args, startedAt: Date.now(), mocked: e.mocked, page }
      this.bridge.set(id, c)
      this.emitCall(c)
    } else if (e.k === 'event' && e.cmd) {
      this.emitCall({ id, kind: 'ipc', source: 'bridge', method: 'event', url: e.cmd, result: e.data, status: 200, durationMs: 0, startedAt: Date.now(), page })
    } else if (e.k === 'result') {
      const c = this.bridge.get(id)
      if (!c) return
      this.bridge.delete(id)
      c.durationMs = Date.now() - c.startedAt
      if (c.kind === 'http') {
        if (e.ok && e.http) {
          c.status = e.http.status ?? 0
          c.result = e.http.body
          c.resHeaders = headers(e.http.headers)
          if (c.status >= 400) this.error({ kind: 'network', message: `HTTP ${c.status} ${c.url}` })
        } else {
          c.status = 0
          c.error = e.data ?? 'lỗi'
          this.error({ kind: 'network', message: `${c.error} ${c.url}` })
        }
      } else {
        c.status = e.ok ? 200 : 500
        c.result = e.data
        if (!e.ok) {
          c.error = e.data
          this.error({ kind: 'log', message: `Bridge ${c.url} lỗi: ${(e.data ?? '').slice(0, 300)}` })
        }
      }
      this.emitCall(c)
    }
  }

  /** Tauri IPC hook events: {k:'call', id, cmd, args} / {k:'result', id, ok, data}. */
  private onIpc(pageId: string, json: string): void {
    let e: { k: string; id: string | number; cmd?: string; args?: string; ok?: boolean; data?: string; mocked?: string }
    try {
      e = JSON.parse(json)
    } catch {
      return
    }
    const id = `${pageId}:ipc${e.id}`
    if (e.k === 'call' && e.cmd) {
      const c: NetCall = { id, kind: 'ipc', method: 'invoke', url: e.cmd, args: e.args, startedAt: Date.now(), mocked: e.mocked }
      this.ipc.set(id, c)
      if (this.decodeHttpCall(c)) return // shown as a decoded HTTP call instead
      this.emitCall(c)
    } else if (e.k === 'result') {
      const c = this.ipc.get(id)
      if (!c) return
      c.status = e.ok ? 200 : 500
      c.result = e.data
      if (!e.ok) c.error = e.data
      c.durationMs = Date.now() - c.startedAt
      if (this.decodeHttpResult(c)) return
      this.emitCall(c)
      if (!e.ok && this.opts.errors) this.error({ kind: 'log', message: `Lệnh ${c.url} lỗi: ${(e.data ?? '').slice(0, 300)}` })
    }
  }

  /**
   * Tauri's HTTP plugin performs requests in Rust: `plugin:http|fetch` carries the request
   * (clientConfig.url / method / data) and returns a resource id; `plugin:http|fetch_send`
   * returns the status. Turn that pair into one readable HTTP call.
   */
  private decodeHttpCall(c: NetCall): boolean {
    if (!c.url.startsWith('plugin:http|')) return false
    const args = (() => {
      try {
        return JSON.parse(c.args ?? '{}')
      } catch {
        return {}
      }
    })()
    if (c.url === 'plugin:http|fetch') {
      const cfg = args.clientConfig ?? args
      const http: NetCall = {
        id: `${c.id}:http`,
        kind: 'http',
        viaTauri: true,
        method: String(cfg.method ?? 'GET').toUpperCase(),
        url: String(cfg.url ?? '(không rõ URL)'),
        args: cfg.data !== undefined && cfg.data !== null ? clip(typeof cfg.data === 'string' ? cfg.data : JSON.stringify(cfg.data)) : undefined,
        resourceType: 'Tauri HTTP',
        startedAt: c.startedAt,
        mocked: c.mocked
      }
      this.http.set(http.id, http)
      this.httpByIpc.set(c.id, http.id)
      this.emitCall(http)
      return true
    }
    if (typeof args.rid === 'number') {
      const hid = this.httpByRid.get(args.rid)
      if (hid) this.httpByIpc.set(c.id, hid)
    }
    return true // fetch_send / fetch_read_body / fetch_cancel are plumbing
  }

  private decodeHttpResult(c: NetCall): boolean {
    if (!c.url.startsWith('plugin:http|')) return false
    const hid = this.httpByIpc.get(c.id)
    const http = hid ? this.http.get(hid) : undefined
    if (!http) return true
    let data: any // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      data = JSON.parse(c.result ?? 'null')
    } catch {
      data = c.result
    }
    if (c.url === 'plugin:http|fetch') {
      if (typeof data === 'number') this.httpByRid.set(data, http.id)
      if (c.status !== 200) {
        http.status = 0
        http.error = String(c.result ?? 'lỗi')
        http.durationMs = c.durationMs
        this.emitCall(http)
        this.error({ kind: 'network', message: `${http.error} ${http.url}` })
      }
    } else if (c.url === 'plugin:http|fetch_send') {
      if (c.status === 200 && data && typeof data.status === 'number') {
        http.status = data.status
        http.durationMs = Date.now() - http.startedAt
        if (data.status >= 400) this.error({ kind: 'network', message: `HTTP ${data.status} ${http.url}` })
      } else {
        http.status = 0
        http.error = String(c.result ?? 'lỗi')
      }
      this.emitCall(http)
    } else if (c.url === 'plugin:http|fetch_read_body' && c.status === 200) {
      http.result = typeof data === 'string' ? clip(data) : Array.isArray(data) ? `[dữ liệu ${data.length} byte]` : clip(c.result)
      this.emitCall(http)
    }
    return true
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    // Never leave fake behaviour behind in the app.
    if (this.mocks.length || this.profile) {
      this.profile = null
      await this.setMocks([]).catch(() => {})
    }
    for (const s of this.sockets.values()) s.ws.close()
    this.sockets.clear()
    for (const port of this.ports.values()) await adb(['-s', this.serial, 'forward', '--remove', `tcp:${port}`])
    this.ports.clear()
  }
}
