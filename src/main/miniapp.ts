import { BrowserWindow, session, type Session } from 'electron'
import { adb, q, shell } from './adb'
import type { MiniAppInfo, MiniAppList, OpenTiming, WebPage, WebViewProc } from '../shared/miniapp'

/* ------------------------------------------------------------ WebView list */

/** serial + socket → forwarded local port (kept while ADB Kit runs; removed by closeForwards). */
const forwards = new Map<string, number>()

async function portFor(serial: string, socket: string): Promise<number> {
  const key = `${serial}|${socket}`
  const known = forwards.get(key)
  if (known) return known
  // Reuse a forward left by an earlier run (e.g. ADB Kit was killed) instead of piling up new ones.
  const existing = await adb(['-s', serial, 'forward', '--list'])
  const line = existing.stdout.split('\n').find((l) => l.trim().endsWith(` localabstract:${socket}`) && l.startsWith(`${serial} `))
  const reuse = line ? parseInt(/tcp:(\d+)/.exec(line)?.[1] ?? '', 10) : 0
  if (reuse) {
    forwards.set(key, reuse)
    return reuse
  }
  const r = await adb(['-s', serial, 'forward', 'tcp:0', `localabstract:${socket}`])
  const port = parseInt(r.stdout.trim(), 10)
  if (!port) throw new Error(r.stderr.trim() || 'không chuyển tiếp được cổng DevTools')
  forwards.set(key, port)
  return port
}

async function getJson<T>(port: number, path: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(4000) })
  return (await res.json()) as T
}

/**
 * Every DevTools socket on the device: WebViews of debuggable apps (or apps that enabled
 * WebView debugging) and Chrome. Each comes with its open pages.
 */
export async function listWebViews(serial: string): Promise<WebViewProc[]> {
  const [unix, ps] = await Promise.all([shell(serial, 'cat /proc/net/unix'), shell(serial, 'ps -A -o PID,NAME')])
  const names = new Map<number, string>()
  for (const line of ps.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line)
    if (m) names.set(Number(m[1]), m[2])
  }
  const sockets = [...new Set([...unix.stdout.matchAll(/@([\w.]*_devtools_remote(?:_\d+)?)\s*$/gm)].map((m) => m[1]))]
  const out: WebViewProc[] = []
  for (const socket of sockets) {
    const pid = Number(/_(\d+)$/.exec(socket)?.[1] ?? 0)
    const pkg = pid ? (names.get(pid) ?? `pid ${pid}`) : socket.startsWith('chrome') ? 'com.android.chrome' : socket.replace(/_devtools_remote$/, '')
    if (pid && !names.has(pid)) continue // stale socket of a dead process
    const proc: WebViewProc = { socket, pid, pkg, pages: [] }
    try {
      const port = await portFor(serial, socket)
      const [ver, list] = await Promise.all([
        getJson<{ Browser?: string }>(port, '/json/version').catch(() => ({}) as { Browser?: string }),
        getJson<{ id: string; type: string; title: string; url: string; description?: string }[]>(port, '/json/list')
      ])
      proc.browser = ver.Browser
      proc.pages = list
        .filter((p) => p.type === 'page' || p.type === 'iframe' || p.type === 'webview')
        .map((p): WebPage => {
          let visible: boolean | undefined
          try {
            const d = JSON.parse(p.description || '{}') as { visible?: boolean; attached?: boolean }
            visible = d.visible ?? d.attached
          } catch {
            /* Chrome tabs have no description */
          }
          return { id: p.id, type: p.type, title: p.title, url: p.url, visible }
        })
    } catch (e) {
      proc.error = (e as Error).message
      forwards.delete(`${serial}|${socket}`)
    }
    out.push(proc)
  }
  // Visible pages and apps first; Chrome last.
  return out.sort((a, b) => Number(b.pages.some((p) => p.visible)) - Number(a.pages.some((p) => p.visible)) || Number(a.pid === 0) - Number(b.pid === 0))
}

let devSes: Session | null = null

/**
 * Session for DevTools windows. The phone's WebView/Chrome refuses DevTools WebSockets whose
 * Origin isn't allowed (--remote-allow-origins); the bundled front-end sends
 * "devtools://devtools", so drop the header on connections to the forwarded local ports —
 * the same way command-line DevTools clients connect.
 */
function devtoolsSession(): Session {
  if (devSes) return devSes
  devSes = session.fromPartition('adbkit-devtools')
  devSes.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*', 'ws://127.0.0.1:*/*'] }, (d, cb) => {
    const h = { ...d.requestHeaders }
    delete h.Origin
    delete h.origin
    cb({ requestHeaders: h })
  })
  return devSes
}

/**
 * Open Chrome DevTools for one page in an ADB Kit window (Elements, Console, Network,
 * Sources…). Uses the DevTools front-end built into Electron, so no internet is needed.
 */
export async function openDevTools(serial: string, socket: string, page: WebPage): Promise<void> {
  const port = await portFor(serial, socket)
  const ws = `127.0.0.1:${port}/devtools/page/${page.id}`
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `DevTools — ${page.title || page.url}`,
    autoHideMenuBar: true,
    backgroundColor: '#202124',
    webPreferences: { session: devtoolsSession() }
  })
  await win.loadURL(`devtools://devtools/bundled/inspector.html?ws=${ws}`)
}

export async function closeForwards(): Promise<void> {
  for (const [key, port] of forwards) {
    const serial = key.split('|')[0]
    await adb(['-s', serial, 'forward', '--remove', `tcp:${port}`])
  }
  forwards.clear()
}

/* --------------------------------------------------------- open timing */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Evaluate an expression in a page through a short-lived DevTools connection. */
export async function evalIn(serial: string, socket: string, pageId: string, expression: string): Promise<unknown> {
  const port = await portFor(serial, socket)
  const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${pageId}`)
  try {
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res())
      ws.addEventListener('error', () => rej(new Error('không kết nối được trang')))
      setTimeout(() => rej(new Error('hết thời gian kết nối trang')), 4000)
    })
    const reply = await new Promise<{ result?: { result?: { value?: unknown } } }>((res, rej) => {
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(String(ev.data))
        if (m.id === 1) res(m)
      })
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
      setTimeout(() => rej(new Error('trang không trả lời')), 5000)
    })
    return reply.result?.result?.value
  } finally {
    ws.close()
  }
}

/** Collected in the page: navigation + paint + resource timing (relative to timeOrigin). */
const TIMING_JS = `(async () => {
  const n = performance.getEntriesByType('navigation')[0] || {}
  const paint = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')
  const lcp = await new Promise((res) => {
    try {
      new PerformanceObserver((l) => { const e = l.getEntries(); res(e.length ? e[e.length - 1].startTime : null) })
        .observe({ type: 'largest-contentful-paint', buffered: true })
      setTimeout(() => res(null), 150)
    } catch (e) { res(null) }
  })
  const res = performance.getEntriesByType('resource').map((r) => [r.name, Math.round(r.duration), r.transferSize || 0, Math.round(r.responseEnd)])
  // Paint metrics are not recorded when the page started loading while hidden (spec): then the
  // moment it became visible is the best available "shown on screen" mark.
  let shown = 0
  try { const v = performance.getEntriesByType('visibility-state').filter((e) => e.name === 'visible'); shown = v.length ? v[0].startTime : 0 } catch (e) {}
  const hiddenStart = (() => { try { const v = performance.getEntriesByType('visibility-state'); return !!(v[0] && v[0].name === 'hidden') } catch (e) { return false } })()
  return { origin: performance.timeOrigin, url: location.href, title: document.title, state: document.readyState,
    html: n.responseEnd || 0, dom: n.domContentLoadedEventEnd || 0, load: n.loadEventEnd || 0,
    fcp: paint ? paint.startTime : 0, lcp: lcp || 0, shown, hiddenStart, res }
})()`

interface PageTiming {
  origin: number
  url: string
  title: string
  state: string
  html: number
  dom: number
  load: number
  fcp: number
  lcp: number
  shown: number
  hiddenStart: boolean
  res: [string, number, number, number][]
}

/** PC clock → device clock offset (ms), so device-side timestamps line up with the tap. */
async function clockOffset(serial: string): Promise<number> {
  const a = Date.now()
  const r = await shell(serial, 'date +%s%3N')
  const b = Date.now()
  const dev = Number(r.stdout.trim())
  return Number.isFinite(dev) && dev > 1e12 ? dev - (a + b) / 2 : 0
}

const ownProcs = async (serial: string, pkg: string): Promise<WebViewProc[]> =>
  (await listWebViews(serial)).filter((p) => p.pkg === pkg || p.pkg.startsWith(`${pkg}:`))

/**
 * Open a mini-app (deep link) and measure how long it takes: until its WebView page starts
 * loading (container + bundle), then HTML, DOM ready, first paint, main content (LCP), load and
 * network quiet, from the page's own timing. `cold` first deletes the downloaded bundle and
 * restarts the app, like a first open after install / update.
 */
export async function measureOpen(serial: string, pkg: string, url: string, appId?: string, cold = false): Promise<OpenTiming> {
  const at = Date.now()
  const fail = (error: string): OpenTiming => ({ ok: false, error, at, cold })
  if (cold) {
    if (!appId) return fail('Cần appId để xóa gói trước khi đo')
    await clearMiniAppCache(serial, pkg, appId)
    await sleep(800)
  }
  const before = new Map<string, string>()
  for (const p of await ownProcs(serial, pkg)) for (const pg of p.pages) before.set(pg.id, pg.url)
  const offset = await clockOffset(serial)
  const t0 = Date.now()
  await openLink(serial, url, pkg)
  // Wait for a new page (or an existing page that navigated) with a real URL.
  let found: { socket: string; id: string } | null = null
  for (let i = 0; i < 120 && !found; i++) {
    await sleep(250)
    for (const p of await ownProcs(serial, pkg).catch(() => [])) {
      const pg = p.pages.find((x) => !/^about:|^$/.test(x.url) && (!before.has(x.id) || before.get(x.id) !== x.url))
      if (pg) found = { socket: p.socket, id: pg.id }
    }
  }
  if (!found) return fail('Sau 30 giây vẫn không thấy trang WebView mới của miniapp (app chưa đăng nhập, link sai, hoặc WebView không bật debug?)')
  // Poll the page's timing until it has loaded and the network has been quiet for ~1.2 s.
  let t: PageTiming | null = null
  let lastCount = -1
  let quietSince = 0
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    t = (await evalIn(serial, found.socket, found.id, TIMING_JS).catch(() => null)) as PageTiming | null
    if (t && t.load > 0) {
      if (t.res.length !== lastCount) {
        lastCount = t.res.length
        quietSince = Date.now()
      } else if (Date.now() - quietSince > 1200) break
    }
    await sleep(400)
  }
  if (!t) return fail('Không đọc được số liệu thời gian của trang')
  // The page's clock starts at timeOrigin (device clock); the tap was at t0 (PC clock).
  const start = t.origin - offset - t0
  const rel = (v: number): number | undefined => (v > 0 ? Math.round(start + v) : undefined)
  const idleEnd = Math.max(t.load, ...t.res.map((r) => r[3]))
  return {
    ok: true,
    at,
    cold,
    url: t.url,
    title: t.title,
    webviewMs: Math.max(0, Math.round(start)),
    htmlMs: rel(t.html),
    domMs: rel(t.dom),
    fcpMs: rel(t.fcp),
    lcpMs: rel(t.lcp),
    shownMs: rel(t.shown),
    paintNote: t.fcp
      ? undefined
      : t.hiddenStart
        ? 'Trang bắt đầu tải khi còn ẩn nên trình duyệt không ghi mốc vẽ (FCP/LCP) — xem mốc "Hiện lên màn hình".'
        : 'Trình duyệt không ghi mốc vẽ (FCP/LCP) cho trang này — dùng mốc Load / Mạng yên.',
    loadMs: rel(t.load),
    idleMs: rel(idleEnd),
    resources: t.res.length,
    transferKb: Math.round(t.res.reduce((n, r) => n + r[2], 0) / 1024),
    slowest: [...t.res].sort((a, b) => b[1] - a[1]).slice(0, 5).map((r) => ({ name: r[0].replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(-80), ms: r[1] }))
  }
}

/* --------------------------------------------------------- mini-app list */

const unxml = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')

const runAs = (serial: string, pkg: string, cmd: string): ReturnType<typeof shell> => shell(serial, `run-as ${q(pkg)} sh -c ${q(cmd)}`)

/** Where the Capacitor (Cainiao) mini-app container keeps its data inside the app. */
const CAP_PREFS = 'shared_prefs/cap_miniapp_prefs.xml'
const CAP_CACHE = 'files/cap_miniapp/cache'

/**
 * Mini-apps the super-app has downloaded, read from its own data with `run-as`
 * (works for debuggable builds). Supports the Capacitor mini-app container.
 */
export async function listMiniApps(serial: string, pkg: string): Promise<MiniAppList> {
  const prefs = await runAs(serial, pkg, `cat ${CAP_PREFS} 2>/dev/null; echo; echo __DU__; du -sk ${CAP_CACHE}/* 2>/dev/null`)
  const text = prefs.stdout
  if (/not debuggable|package not debuggable/i.test(text + prefs.stderr)) {
    return { container: null, apps: [], note: 'App không phải bản debug — không đọc được dữ liệu miniapp (run-as bị chặn).' }
  }
  if (/unknown package|is unknown/i.test(text + prefs.stderr)) return { container: null, apps: [], note: 'Không tìm thấy app trên máy.' }
  const [xml, du = ''] = text.split('__DU__')
  const apps = new Map<string, MiniAppInfo>()
  const get = (id: string): MiniAppInfo => {
    let a = apps.get(id)
    if (!a) apps.set(id, (a = { appId: id, name: id }))
    return a
  }
  for (const m of xml.matchAll(/<string name="meta_([\w-]+)">([\s\S]*?)<\/string>/g)) {
    try {
      const meta = JSON.parse(unxml(m[2])) as { appName?: string; appIcon?: string; appType?: string; miniAppId?: number; version?: string }
      const a = get(m[1])
      a.name = meta.appName || a.name
      a.icon = meta.appIcon
      a.type = meta.appType
      a.miniAppId = meta.miniAppId
      a.version = meta.version ?? a.version
    } catch {
      /* malformed entry */
    }
  }
  for (const m of xml.matchAll(/<string name="version_([\w-]+)">([^<]*)<\/string>/g)) get(m[1]).version = unxml(m[2])
  for (const m of xml.matchAll(/<long name="(first_cached|last_updated)_([\w-]+)" value="(\d+)"/g)) {
    const a = get(m[2])
    if (m[1] === 'first_cached') a.firstCachedAt = Number(m[3])
    else a.updatedAt = Number(m[3])
  }
  for (const line of du.split('\n')) {
    const m = /^(\d+)\s+\S*\/([\w-]+)\s*$/.exec(line.trim())
    if (m) get(m[2]).cacheKb = Number(m[1])
  }
  const found = /<map>/.test(xml) || apps.size > 0
  return {
    container: found ? 'Capacitor miniapp' : null,
    apps: [...apps.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name)),
    note: found ? undefined : 'Không thấy dữ liệu miniapp trong app này (chưa hỗ trợ loại container này, hoặc chưa mở miniapp nào).'
  }
}

/**
 * Delete one mini-app's downloaded bundle so the container fetches it again on next open.
 * The app is stopped first so it doesn't keep serving the old files from memory.
 */
export async function clearMiniAppCache(serial: string, pkg: string, appId: string): Promise<void> {
  if (!/^[\w-]+$/.test(appId)) throw new Error('appId không hợp lệ')
  await shell(serial, `am force-stop ${q(pkg)}`)
  const r = await runAs(serial, pkg, `rm -rf ${CAP_CACHE}/${appId} && echo done`)
  if (!r.stdout.includes('done')) throw new Error(r.stderr.trim() || r.stdout.trim() || 'không xóa được')
}

/** Open a deep link (VIEW intent), optionally restricted to one app. */
export async function openLink(serial: string, url: string, pkg?: string): Promise<string> {
  const r = await shell(serial, `am start -W -a android.intent.action.VIEW -d ${q(url)}${pkg ? ` ${q(pkg)}` : ''}`, 20_000)
  const out = (r.stdout + r.stderr).trim()
  if (/^Error|Exception|unable to resolve/im.test(out)) throw new Error(out.split('\n').find((l) => /Error|Exception|unable/i.test(l)) ?? out)
  return out
}
