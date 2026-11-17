// Capturing proxy for apps that have no WebView and no Chucker (native apps, any build).
// It runs on the PC and listens on 127.0.0.1 only; the phone reaches it through `adb reverse`.
//
//  - Plain HTTP: every request and response is recorded.
//  - HTTPS without decryption: only the host name, timing and byte counts of the tunnel.
//  - HTTPS with decryption: the proxy answers with a certificate signed by ADB Kit's own CA.
//    Only apps that trust user-installed CAs accept it (debug builds, usually). A host whose
//    client refuses the certificate is switched to a plain tunnel so the app keeps working.
//
// No Electron imports here: the engine is exercised by unit tests under plain Node.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'
import forge from 'node-forge'
import type { NetCall } from '../shared/automation'

export interface CaFiles {
  keyPem: string
  certPem: string
}

const serial = (): string => '01' + randomBytes(15).toString('hex') // positive, 16 bytes
const days = (n: number): Date => new Date(Date.now() + n * 86_400_000)

function newKeyPair(): { privateKey: forge.pki.rsa.PrivateKey; publicKey: forge.pki.rsa.PublicKey; keyPem: string } {
  // Node generates RSA keys natively (fast); forge only signs.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return {
    privateKey: forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey,
    publicKey: forge.pki.publicKeyFromPem(publicKey) as forge.pki.rsa.PublicKey,
    keyPem: privateKey
  }
}

/** A new certificate authority, unique to this PC. Its private key never leaves the PC. */
export function createCa(): CaFiles {
  const k = newKeyPair()
  const cert = forge.pki.createCertificate()
  cert.publicKey = k.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = days(-1)
  cert.validity.notAfter = days(3650)
  const name = [
    { name: 'commonName', value: `ADB Kit Proxy CA ${randomBytes(3).toString('hex')}` },
    { name: 'organizationName', value: 'ADB Kit (local test proxy)' }
  ]
  cert.setSubject(name)
  cert.setIssuer(name)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ])
  cert.sign(k.privateKey, forge.md.sha256.create())
  return { keyPem: k.keyPem, certPem: forge.pki.certificateToPem(cert) }
}

/** Issues (and caches) one certificate per host, all signed by the CA. */
export class CertStore {
  private readonly caKey: forge.pki.rsa.PrivateKey
  private readonly caCert: forge.pki.Certificate
  private readonly leaf = newKeyPair() // one key for every host: generating keys is the slow part
  private readonly cache = new Map<string, tls.SecureContext>()

  constructor(private readonly ca: CaFiles) {
    this.caKey = forge.pki.privateKeyFromPem(ca.keyPem) as forge.pki.rsa.PrivateKey
    this.caCert = forge.pki.certificateFromPem(ca.certPem)
  }

  /** PEM of a certificate for `host` (exposed for tests). */
  certFor(host: string): string {
    const cert = forge.pki.createCertificate()
    cert.publicKey = this.leaf.publicKey
    cert.serialNumber = serial()
    cert.validity.notBefore = days(-1)
    cert.validity.notAfter = days(300) // clients reject leaf certificates valid for more than 398 days
    cert.setSubject([{ name: 'commonName', value: host.slice(0, 64) }])
    cert.setIssuer(this.caCert.subject.attributes)
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [net.isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }] }
    ])
    cert.sign(this.caKey, forge.md.sha256.create())
    return forge.pki.certificateToPem(cert)
  }

  contextFor(host: string): tls.SecureContext {
    let ctx = this.cache.get(host)
    if (!ctx) {
      ctx = tls.createSecureContext({ key: this.leaf.keyPem, cert: this.certFor(host) + this.ca.certPem })
      this.cache.set(host, ctx)
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string)
    }
    return ctx
  }
}

export interface ProxyHandlers {
  onCall: (c: NetCall) => void
  onInfo?: (msg: string) => void
}

export interface ProxyOptions {
  /** Decrypt HTTPS with this CA. Without it HTTPS is tunnelled and only host names are seen. */
  ca?: CaFiles
  /** Extra CA trusted for the real servers (tests use a private one). */
  upstreamCa?: string
}

const CAPTURE = 256 * 1024 // bytes kept per body for display
const SHOWN = 64_000
const HANDSHAKE_MS = 10_000
const TEXTUAL = /json|text|xml|javascript|x-www-form-urlencoded|graphql|html/i
const HOP = new Set(['proxy-connection', 'proxy-authorization', 'proxy-authenticate'])

type Target = { secure: boolean; host: string; port: number; /** Requests seen on this decrypted connection. */ requests?: number }

/** Collects the first CAPTURE bytes of a stream and counts all of them. */
class Tap {
  private chunks: Buffer[] = []
  private kept = 0
  total = 0
  add(b: Buffer): void {
    this.total += b.length
    if (this.kept >= CAPTURE) return
    const part = b.length > CAPTURE - this.kept ? b.subarray(0, CAPTURE - this.kept) : b
    this.chunks.push(part)
    this.kept += part.length
  }
  get bytes(): Buffer {
    return Buffer.concat(this.chunks)
  }
  get truncated(): boolean {
    return this.total > this.kept
  }
}

/** Body as text for the call list; undefined when there is none. */
export function bodyText(tap: { bytes: Buffer; total: number; truncated: boolean }, headers: http.IncomingHttpHeaders): string | undefined {
  if (!tap.total) return undefined
  const type = String(headers['content-type'] ?? '')
  const enc = String(headers['content-encoding'] ?? '').toLowerCase()
  let buf = tap.bytes
  try {
    // A body cut at CAPTURE bytes is still inflated as far as it goes.
    const partial = { finishFlush: zlib.constants.Z_SYNC_FLUSH }
    if (enc === 'gzip' || enc === 'x-gzip') buf = zlib.gunzipSync(buf, partial)
    else if (enc === 'deflate') buf = zlib.inflateSync(buf, partial)
    else if (enc === 'br') buf = zlib.brotliDecompressSync(buf, { finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH })
    else if (enc && enc !== 'identity') return `[nội dung nén ${enc}, ${tap.total} byte]`
  } catch {
    return `[không giải nén được nội dung ${enc}, ${tap.total} byte]`
  }
  if (type && !TEXTUAL.test(type)) return `[dữ liệu nhị phân ${tap.total} byte${type ? `, ${type.split(';')[0]}` : ''}]`
  const text = buf.toString('utf8')
  if (!type && /[\u0000-\u0008�]/.test(text.slice(0, 2000))) return `[dữ liệu nhị phân ${tap.total} byte]`
  const cut = text.length > SHOWN ? `${text.slice(0, SHOWN)}…(${text.length} ký tự)` : text
  return tap.truncated ? `${cut}\n…(chỉ giữ ${CAPTURE} byte đầu trong ${tap.total} byte)` : cut
}

const pairs = (raw: string[]): { name: string; value: string }[] => {
  const out: { name: string; value: string }[] = []
  for (let i = 0; i + 1 < raw.length; i += 2) out.push({ name: raw[i], value: raw[i + 1] })
  return out
}

/** Raw header list without the hop-by-hop proxy headers. */
const forwardable = (raw: string[]): string[] => {
  const out: string[] = []
  for (let i = 0; i + 1 < raw.length; i += 2) if (!HOP.has(raw[i].toLowerCase())) out.push(raw[i], raw[i + 1])
  return out
}

export function parseAuthority(authority: string, defaultPort: number): { host: string; port: number } | null {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(authority) ?? /^([^:]+)(?::(\d+))?$/.exec(authority)
  if (!m || !m[1]) return null
  const port = m[2] ? Number(m[2]) : defaultPort
  return port > 0 && port < 65536 ? { host: m[1], port } : null
}

const originOf = (t: Target): string => {
  const host = t.host.includes(':') ? `[${t.host}]` : t.host
  const std = t.secure ? 443 : 80
  return `${t.secure ? 'https' : 'http'}://${host}${t.port === std ? '' : `:${t.port}`}`
}

export class ProxyServer {
  port = 0
  private readonly outer: http.Server
  /** Parses the HTTP inside decrypted connections; never listens on its own. */
  private readonly inner: http.Server
  private readonly certs: CertStore | null
  private readonly sockets = new Set<Duplex>()
  private readonly targets = new WeakMap<Duplex, Target>()
  /** Hosts whose client refused our certificate: tunnelled untouched from then on. */
  private readonly bypass = new Set<string>()
  private readonly decrypted = new Set<string>()
  private seq = 0
  private readonly tag = randomBytes(3).toString('hex')

  constructor(
    private readonly h: ProxyHandlers,
    private readonly opts: ProxyOptions = {}
  ) {
    this.certs = opts.ca ? new CertStore(opts.ca) : null
    this.outer = http.createServer((req, res) => this.onPlain(req, res))
    this.outer.on('connect', (req, sock, head) => this.onConnect(req, sock, head))
    this.outer.on('upgrade', (req, sock, head) => this.onUpgrade(req, sock, head, null))
    this.outer.on('connection', (s) => this.track(s))
    this.outer.on('clientError', (_e, s) => s.destroy())
    this.inner = http.createServer((req, res) => {
      const t = this.targets.get(req.socket)
      if (!t) return void res.destroy()
      t.requests = (t.requests ?? 0) + 1
      this.forward(req, res, t)
    })
    this.inner.on('upgrade', (req, sock, head) => {
      const t = this.targets.get(req.socket)
      if (t) t.requests = (t.requests ?? 0) + 1
      this.onUpgrade(req, sock, head, t ?? null)
    })
    this.inner.on('clientError', (_e, s) => s.destroy())
  }

  get decrypting(): boolean {
    return !!this.certs
  }

  start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.outer.once('error', reject)
      this.outer.listen(port, '127.0.0.1', () => {
        this.port = (this.outer.address() as net.AddressInfo).port
        resolve(this.port)
      })
    })
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy()
    this.sockets.clear()
    await new Promise<void>((r) => this.outer.close(() => r()))
  }

  private track(s: Duplex): void {
    this.sockets.add(s)
    s.once('close', () => this.sockets.delete(s))
  }

  private id(): string {
    return `proxy:${this.tag}:${++this.seq}`
  }

  /* ---------------------------------------------------------- plain HTTP */

  private onPlain(req: http.IncomingMessage, res: http.ServerResponse): void {
    let url: URL
    try {
      url = new URL(req.url ?? '')
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('ADB Kit proxy: this address is a proxy, not a web site.')
      return
    }
    if (url.protocol !== 'http:') {
      res.writeHead(400)
      res.end()
      return
    }
    req.url = url.pathname + url.search
    this.forward(req, res, { secure: false, host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || 80 })
  }

  /** Send one request to the real server, stream the answer back and record both. */
  private forward(req: http.IncomingMessage, res: http.ServerResponse, t: Target): void {
    const call: NetCall = {
      id: this.id(),
      kind: 'http',
      source: 'proxy',
      method: req.method ?? 'GET',
      url: originOf(t) + (req.url ?? '/'),
      reqHeaders: pairs(req.rawHeaders),
      resourceType: t.secure ? 'HTTPS' : 'HTTP',
      startedAt: Date.now()
    }
    if (t.secure) this.decrypted.add(t.host)
    const sent = new Tap()
    const fail = (message: string): void => {
      call.status = 0
      call.error = message
      call.durationMs = Date.now() - call.startedAt
      this.h.onCall(call)
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`ADB Kit proxy: ${message}`)
    }
    const up = (t.secure ? https : http).request({
      host: t.host,
      port: t.port,
      method: req.method,
      path: req.url,
      headers: forwardable(req.rawHeaders),
      servername: t.secure && !net.isIP(t.host) ? t.host : undefined,
      ca: this.opts.upstreamCa ? [...tls.rootCertificates, this.opts.upstreamCa] : undefined,
      agent: false
    })
    up.on('error', (e) => fail(e.message))
    up.on('response', (ur) => {
      call.status = ur.statusCode ?? 0
      call.resHeaders = pairs(ur.rawHeaders)
      const got = new Tap()
      res.writeHead(ur.statusCode ?? 502, ur.statusMessage, ur.rawHeaders)
      ur.on('data', (b: Buffer) => got.add(b))
      ur.on('end', () => {
        call.result = bodyText(got, ur.headers)
        call.durationMs = Date.now() - call.startedAt
        this.h.onCall(call)
      })
      ur.on('error', (e) => fail(e.message))
      ur.pipe(res)
    })
    req.on('data', (b: Buffer) => sent.add(b))
    req.on('end', () => {
      call.args = bodyText(sent, req.headers)
      this.h.onCall(call) // shown as pending until the answer arrives
    })
    req.on('error', () => up.destroy())
    res.on('close', () => {
      if (!res.writableEnded) up.destroy()
    })
    req.pipe(up)
  }

  /* --------------------------------------------------------------- HTTPS */

  private onConnect(req: http.IncomingMessage, client: Duplex, head: Buffer): void {
    this.track(client)
    client.on('error', () => {})
    const a = parseAuthority(req.url ?? '', 443)
    if (!a) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    // Decryption takes over the raw socket, so it must start before any byte is read from it
    // (a TLS wrapper reads from the OS handle and would never see data already pulled into JS).
    // Whatever is not TLS simply fails the handshake once and is tunnelled from then on.
    if (this.certs && !this.bypass.has(a.host) && !head.length) {
      this.decrypt(client, a)
      return
    }
    const begin = (first: Buffer): void => this.tunnel(client, first, a, first[0] === 0x16) // 0x16 = TLS handshake record
    if (head.length) begin(head)
    else client.once('data', begin)
  }

  /** Pass bytes through untouched; all we learn is the host, the duration and the volume. */
  private tunnel(client: Duplex, first: Buffer, a: { host: string; port: number }, isTls: boolean): void {
    const call: NetCall = {
      id: this.id(),
      kind: 'http',
      source: 'proxy',
      method: 'CONNECT',
      url: originOf({ secure: isTls, ...a }) + '/',
      resourceType: 'tunnel',
      startedAt: Date.now()
    }
    let up = 0
    let down = 0
    const server = net.connect(a.port, a.host)
    this.track(server)
    let done = false
    const finish = (error?: string): void => {
      if (done) return
      done = true
      call.durationMs = Date.now() - call.startedAt
      if (error && !down) {
        call.status = 0
        call.error = error
      } else {
        call.status = 200
        call.result = `[${isTls ? 'HTTPS chưa giải mã' : 'kết nối không phải HTTP'}: chỉ thấy tên máy chủ. Gửi ${up} byte, nhận ${down} byte]`
      }
      this.h.onCall(call)
      client.destroy()
      server.destroy()
    }
    server.on('connect', () => {
      this.h.onCall(call)
      up += first.length
      server.write(first)
      client.on('data', (b: Buffer) => (up += b.length))
      server.on('data', (b: Buffer) => (down += b.length))
      client.pipe(server)
      server.pipe(client)
    })
    server.on('error', (e) => finish(e.message))
    server.on('close', () => finish())
    client.on('close', () => finish())
  }

  private decrypt(client: Duplex, a: { host: string; port: number }): void {
    const secure = new tls.TLSSocket(client as net.Socket, {
      isServer: true,
      secureContext: this.certs!.contextFor(a.host),
      ALPNProtocols: ['http/1.1']
    })
    this.track(secure)
    const target: Target = { secure: true, ...a }
    this.targets.set(secure, target)
    // An app that does not trust the CA aborts the handshake (or closes right after it) without
    // sending a request. Stop decrypting that host so the app works again on its next attempt.
    const refused = (): void => {
      if (target.requests || this.decrypted.has(a.host) || this.bypass.has(a.host)) return
      this.bypass.add(a.host)
      this.h.onInfo?.(`${a.host}: app không tin chứng chỉ của ADB Kit — từ giờ chỉ theo dõi tên máy chủ, không giải mã`)
      this.h.onCall({
        id: this.id(),
        kind: 'http',
        source: 'proxy',
        method: 'CONNECT',
        url: originOf({ secure: true, ...a }) + '/',
        resourceType: 'tunnel',
        startedAt: Date.now(),
        durationMs: 0,
        status: 0,
        error: 'app từ chối chứng chỉ của ADB Kit (không tin CA người dùng cài, hoặc có ghim chứng chỉ). Lần gọi sau sẽ đi thẳng, không giải mã.'
      })
    }
    // A handshake that fails on a TLSSocket created by hand is reported only through the
    // internal '_tlsError' event (tls.Server listens to the same one) and leaves the socket open.
    secure.on('_tlsError', () => {
      refused()
      secure.destroy()
    })
    // The client hanging up during the handshake only ends the stream; it does not close it.
    secure.on('end', () => {
      if (target.requests) return
      refused()
      secure.destroy()
    })
    secure.on('error', refused)
    secure.on('close', refused)
    client.on('close', refused)
    // A client that goes silent in the middle of the handshake must not hold the socket forever.
    const stalled = setTimeout(() => {
      refused()
      secure.destroy()
    }, HANDSHAKE_MS)
    secure.on('close', () => clearTimeout(stalled))
    secure.on('secure', () => {
      clearTimeout(stalled)
      this.inner.emit('connection', secure)
    })
  }

  /* ----------------------------------------------------------- WebSocket */

  private onUpgrade(req: http.IncomingMessage, client: Duplex, head: Buffer, mitm: Target | null): void {
    this.track(client)
    client.on('error', () => {})
    let t = mitm
    let path = req.url ?? '/'
    if (!t) {
      try {
        const u = new URL(path)
        t = { secure: false, host: u.hostname, port: Number(u.port) || 80 }
        path = u.pathname + u.search
      } catch {
        client.destroy()
        return
      }
    }
    const call: NetCall = {
      id: this.id(),
      kind: 'http',
      source: 'proxy',
      method: req.method ?? 'GET',
      url: originOf(t).replace(/^http/, 'ws') + path,
      reqHeaders: pairs(req.rawHeaders),
      resourceType: 'WebSocket',
      startedAt: Date.now()
    }
    const target = t
    const server: Duplex = target.secure
      ? tls.connect({
          host: target.host,
          port: target.port,
          servername: net.isIP(target.host) ? undefined : target.host,
          ALPNProtocols: ['http/1.1'],
          ca: this.opts.upstreamCa ? [...tls.rootCertificates, this.opts.upstreamCa] : undefined
        })
      : net.connect(target.port, target.host)
    this.track(server)
    const lines = [`${req.method} ${path} HTTP/1.1`]
    const raw = forwardable(req.rawHeaders)
    for (let i = 0; i + 1 < raw.length; i += 2) lines.push(`${raw[i]}: ${raw[i + 1]}`)
    server.on(target.secure ? 'secureConnect' : 'connect', () => {
      server.write(lines.join('\r\n') + '\r\n\r\n')
      if (head.length) server.write(head)
      call.status = 101
      this.h.onCall(call)
      client.pipe(server)
      server.pipe(client)
    })
    let done = false
    const finish = (error?: string): void => {
      if (done) return
      done = true
      call.durationMs = Date.now() - call.startedAt
      if (error && call.status === undefined) {
        call.status = 0
        call.error = error
      }
      this.h.onCall(call)
      client.destroy()
      server.destroy()
    }
    server.on('error', (e) => finish(e.message))
    // 'end' as well as 'close': an encrypted socket whose peer hangs up only ends.
    for (const ev of ['close', 'end']) {
      server.on(ev, () => finish())
      client.on(ev, () => finish())
    }
  }
}
