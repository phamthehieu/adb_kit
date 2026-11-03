/**
 * Script injected (through DevTools) into WebViews that use a Capacitor-style native bridge,
 * e.g. super-app mini-app containers (Tammi / Cainiao Capacitor, WindVane-compatible):
 *   JS → native:  window.capacitorNative.postMessage(JSON {type:'plugin', pluginId, method, callbackId, options})
 *   native → JS:  Capacitor.handleCallback(callbackId, error, data) / Capacitor.handleEvent(pluginId, event, data)
 * Every call and its result are reported with console.debug + a marker that ADB Kit filters out.
 * Mini-apps route cross-origin fetch/XHR through the native `WVFetch.request` plugin, so those
 * API calls never reach DevTools' Network domain — this hook is the only way to see them.
 * ADB Kit mock rules (window.__adbkitMocks) are honoured too. Nothing is changed in the app: the
 * hook lives in page memory only and disappears when the page reloads without ADB Kit.
 */
export const CAP_MARK = '__ADBKIT_CAP__'

export const CAP_HOOK_SCRIPT = `(() => {
 let tries = 0
 const install = () => {
  if (window.__adbkitCapHook) return 'already'
  const nat = window.capacitorNative
  const C = window.Capacitor
  if (!nat || typeof nat.postMessage !== 'function' || !C || typeof C.handleCallback !== 'function') {
    // Injected on a new document before the bridge exists: retry for ~3 s, then give up
    // quietly (most pages have no such bridge). No eval: CSP often forbids it.
    if (++tries < 600) setTimeout(install, 5)
    return 'waiting'
  }
  const MARK = '${CAP_MARK}'
  const doc = Math.random().toString(36).slice(2, 8)
  let n = 0
  const pending = new Map()
  const emit = (o) => { try { console.debug(MARK + JSON.stringify(o)) } catch (e) {} }
  const clip = (v, max) => {
    try {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return s && s.length > max ? s.slice(0, max) + '…(' + s.length + ' ký tự)' : s
    } catch (e) { return String(v) }
  }
  const findMock = (cmd, url) => {
    const M = window.__adbkitMocks
    if (!M || !M.rules || !(M.expires > Date.now())) return null
    const c = cmd.toLowerCase(), u = (url || '').toLowerCase()
    for (const r of M.rules) {
      const want = String(r.match || '').toLowerCase()
      if (!want) continue
      if ((r.kind === 'any' || r.kind === 'ipc') && !u && c.indexOf(want) >= 0) return r
      if ((r.kind === 'any' || r.kind === 'http') && u && u.indexOf(want) >= 0) return r
    }
    return null
  }
  // Bad-network profile set by ADB Kit ({ mode, delayMs, failRate, expires }) for API calls.
  const netRule = () => {
    const N = window.__adbkitNet
    if (!N || !(N.expires > Date.now())) return null
    const tag = N.mode === 'slow' ? 'mạng chậm' : N.mode === 'flaky' ? 'mạng chập chờn' : 'mạng mất'
    if (N.mode === 'offline' || (N.mode === 'flaky' && Math.random() < N.failRate))
      return { action: 'error', body: 'ADB Kit: ' + tag + ' (giả lập)', label: tag }
    const ms = N.mode === 'slow' ? N.delayMs * (0.7 + Math.random() * 0.6) : Math.random() * N.delayMs
    return { action: 'delay', delayMs: Math.round(ms), label: tag }
  }
  const origPost = nat.postMessage.bind(nat)
  const post = function (payload) {
    let m = null, rule = null
    try {
      m = typeof payload === 'string' ? JSON.parse(payload) : payload
      if (m && m.type === 'plugin' && m.callbackId) {
        const id = doc + '-' + (++n)
        const cmd = String(m.pluginId) + '.' + String(m.method)
        const o = m.options || {}
        const isFetch = cmd === 'WVFetch.request'
        rule = findMock(cmd, isFetch ? String(o.url || '') : '') || (isFetch ? netRule() : null)
        pending.set(m.callbackId, { id, isFetch })
        emit(isFetch
          ? { k: 'call', id, cmd, http: { method: String(o.method || 'GET').toUpperCase(), url: String(o.url || ''), headers: o.headers || null, body: o.body == null ? undefined : (o.bodyBase64 ? '[dữ liệu nhị phân]' : clip(o.body, 64000)) }, mocked: rule ? (rule.label || rule.action) : undefined }
          : { k: 'call', id, cmd, args: clip(o, 4000), mocked: rule ? (rule.label || rule.action) : undefined })
      }
    } catch (e) {}
    if (rule) {
      const cb = m.callbackId
      const answer = (err, data) => setTimeout(() => { try { window.Capacitor.handleCallback(cb, err, data) } catch (e) {} }, 5)
      if (rule.action === 'delay') { setTimeout(() => origPost(payload), rule.delayMs || 0); return }
      if (rule.action === 'status') {
        let body = rule.body
        if (m.pluginId === 'WVFetch') return answer(null, { status: rule.status || 200, statusText: 'ADB Kit', headers: { 'content-type': 'application/json' }, body: body || '' })
        if ((rule.status || 200) < 400) { try { body = JSON.parse(rule.body) } catch (e) {} return answer(null, body === undefined ? {} : body) }
        return answer({ ret: 'HY_FAILED', message: rule.body || 'ADB Kit: lỗi giả lập ' + rule.status }, null)
      }
      return answer({ ret: 'HY_FAILED', message: rule.body || 'ADB Kit: lỗi giả lập' }, null)
    }
    return origPost(payload)
  }
  // capacitorNative is a Java bridge object (its methods can't be reassigned): replace the
  // window property with a forwarding proxy that keeps every other native method working.
  const proxy = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'postMessage') return post
      const v = nat[k]
      return typeof v === 'function' ? v.bind(nat) : v
    },
    has: (_t, k) => k in nat
  })
  try {
    Object.defineProperty(window, 'capacitorNative', { value: proxy, writable: true, configurable: true })
  } catch (e) { return 'cannot-wrap' }
  const origCb = C.handleCallback
  C.handleCallback = function (callbackId, error, data) {
    const p = pending.get(callbackId)
    if (p) {
      pending.delete(callbackId)
      if (p.isFetch && !error && data) emit({ k: 'result', id: p.id, ok: true, http: { status: data.status || 0, headers: data.headers || null, body: data.isBase64 ? '[dữ liệu nhị phân]' : clip(data.body, 64000) } })
      else emit({ k: 'result', id: p.id, ok: !error, data: clip(error || data, 4000) })
    }
    return origCb.apply(this, arguments)
  }
  const origEv = C.handleEvent
  if (typeof origEv === 'function') {
    C.handleEvent = function (pluginId, eventName, data) {
      emit({ k: 'event', id: doc + '-e' + (++n), cmd: String(pluginId) + ' ⇠ ' + String(eventName), data: clip(data, 2000) })
      return origEv.apply(this, arguments)
    }
  }
  window.__adbkitCapHook = true
  return 'hooked'
 }
 return install()
})()`
