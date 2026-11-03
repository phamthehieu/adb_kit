/**
 * Script injected into a Tauri WebView (debug builds, through DevTools) to observe IPC:
 * every `invoke(cmd, args)` from JS to Rust — e.g. `plugin:http|fetch`, `plugin:sql|select`,
 * or the app's own commands — and its result. Tauri's `invoke` itself is frozen, so we hook
 * the transport underneath (`window.ipc.postMessage`, used on Android) and the callback
 * registry used to deliver results. Nothing is changed in the app; the hook lives only in
 * memory and is gone when the app restarts. Events are reported with console.debug and a
 * marker that ADB Kit filters out of the console stream.
 */
export const TAURI_MARK = '__ADBKIT_IPC__'

export const TAURI_HOOK = `(() => {
 let tries = 0
 const install = () => {
  if (window.__adbkitIpcHook) return 'already'
  const ipc = window.ipc
  if (!ipc || typeof ipc.postMessage !== 'function') {
    // Injected on a new document before the native bridge exists: try again shortly.
    // (No eval: apps commonly forbid it through their Content Security Policy.)
    if (++tries < 400) setTimeout(install, 5)
    return 'waiting'
  }
  const MARK = '${TAURI_MARK}'
  const orig = ipc.postMessage.bind(ipc)
  const pending = new Map()
  // Ids restart on every page load: prefix them with a per-document tag so calls from
  // successive reloads never overwrite each other.
  const doc = Math.random().toString(36).slice(2, 8)
  let n = 0
  const nextId = () => doc + '-' + (++n)
  let patched = false
  const emit = (o) => { try { console.debug(MARK + JSON.stringify(o)) } catch (e) {} }
  const clip = (v, n) => {
    try {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return s && s.length > n ? s.slice(0, n) + '…(' + s.length + ' ký tự)' : s
    } catch (e) { return String(v) }
  }
  const patchCallbacks = () => {
    if (patched) return
    const T = window.__TAURI_INTERNALS__
    const cbs = T && T.callbacks
    if (!cbs || typeof cbs.get !== 'function') return
    patched = true
    const get = cbs.get.bind(cbs)
    cbs.get = (key) => {
      const fn = get(key)
      const p = pending.get(key)
      if (!fn || !p) return fn
      return (data) => {
        pending.delete(p.cb); pending.delete(p.err)
        emit({ k: 'result', id: p.id, ok: key === p.cb, data: clip(data, 4000) })
        return fn(data)
      }
    }
  }
  // window.ipc is a native (Java) bridge object: assigning its methods is silently ignored,
  // so replace the whole window.ipc with a forwarding wrapper (that property is writable).
  // Fake behaviour set by ADB Kit ({ rules, expires }); expires so a crashed ADB Kit can't
  // leave the app failing forever.
  const findMock = (m) => {
    const M = window.__adbkitMocks
    if (!M || !M.rules || !(M.expires > Date.now())) return null
    const cmd = String(m.cmd).toLowerCase()
    const url = cmd === 'plugin:http|fetch' && m.payload && m.payload.clientConfig ? String(m.payload.clientConfig.url || '').toLowerCase() : ''
    for (const r of M.rules) {
      const want = String(r.match || '').toLowerCase()
      if (!want) continue
      if ((r.kind === 'any' || r.kind === 'ipc') && cmd.indexOf(want) >= 0) return r
      if ((r.kind === 'any' || r.kind === 'http') && url && url.indexOf(want) >= 0) return r
    }
    return null
  }
  // Bad-network profile ({ mode, delayMs, failRate, expires }) applies to HTTP made from Rust.
  const netRule = (m) => {
    const N = window.__adbkitNet
    if (!N || !(N.expires > Date.now()) || String(m.cmd) !== 'plugin:http|fetch') return null
    const tag = N.mode === 'slow' ? 'mạng chậm' : N.mode === 'flaky' ? 'mạng chập chờn' : 'mạng mất'
    if (N.mode === 'offline' || (N.mode === 'flaky' && Math.random() < N.failRate)) return { action: 'error', body: 'ADB Kit: ' + tag + ' (giả lập)', label: tag }
    return { action: 'delay', delayMs: Math.round(N.mode === 'slow' ? N.delayMs * (0.7 + Math.random() * 0.6) : Math.random() * N.delayMs), label: tag }
  }
  const wrapper = {
    postMessage(msg) {
      let m = null
      let rule = null
      try {
        patchCallbacks()
        m = typeof msg === 'string' ? JSON.parse(msg) : msg
        if (m && m.cmd && String(m.cmd).indexOf('__TAURI_CHANNEL__') < 0) {
          const id = nextId()
          const p = { id, cb: m.callback, err: m.error }
          pending.set(m.callback, p); pending.set(m.error, p)
          rule = findMock(m) || netRule(m)
          emit({ k: 'call', id, cmd: String(m.cmd), args: clip(m.payload, 4000), mocked: rule ? (rule.label || rule.action) : undefined })
        }
      } catch (e) {}
      if (rule) {
        const T = window.__TAURI_INTERNALS__
        const fire = (ok, data) => { try { T.runCallback(ok ? m.callback : m.error, data) } catch (e) {} }
        if (rule.action === 'delay') { setTimeout(() => orig(msg), rule.delayMs || 0); return }
        // A faked success only makes sense for plain commands; the HTTP plugin needs a real resource id.
        if (rule.action === 'status' && String(m.cmd) !== 'plugin:http|fetch' && (rule.status || 200) < 400) {
          let data = rule.body
          try { data = JSON.parse(rule.body) } catch (e) {}
          setTimeout(() => fire(true, data === undefined ? null : data), 5)
          return
        }
        const why = rule.body || (rule.action === 'status' ? 'HTTP ' + (rule.status || 500) + ' (ADB Kit giả lập)' : 'ADB Kit: lỗi giả lập')
        setTimeout(() => fire(false, why), 5)
        return
      }
      return orig(msg)
    }
  }
  try {
    Object.defineProperty(window, 'ipc', { value: wrapper, writable: true, configurable: true })
  } catch (e) {
    return 'cannot-wrap'
  }
  window.__adbkitIpcHook = true
  return 'hooked'
 }
 return install()
})()`

/** Script injected both into the live page and into every new document. */
export const TAURI_HOOK_SCRIPT = TAURI_HOOK
