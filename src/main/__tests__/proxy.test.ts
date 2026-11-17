import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { X509Certificate } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NetCall } from '../../shared/automation'
import { CertStore, ProxyServer, bodyText, createCa, parseAuthority } from '../proxy'

// A private "internet": the real servers use certificates from `world`, the proxy re-signs
// with its own `proxyCa`, exactly like a phone talking to a real site through ADB Kit.
const world = createCa()
const proxyCa = createCa()
const worldCerts = new CertStore(world)

function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const chunks: Buffer[] = []
  req.on('data', (b: Buffer) => chunks.push(b))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    if (req.url === '/gzip') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
      res.end(zlib.gzipSync(JSON.stringify({ zipped: true })))
    } else if (req.url === '/image') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))
    } else if (req.url === '/cookies') {
      res.writeHead(200, [
        ['Set-Cookie', 'a=1'],
        ['Set-Cookie', 'b=2'],
        ['Content-Type', 'text/plain']
      ] as unknown as http.OutgoingHttpHeaders)
      res.end('ok')
    } else {
      res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ method: req.method, url: req.url, body, via: req.headers['proxy-connection'] ?? null, host: req.headers.host }))
    }
  })
}

let plain: http.Server
let secure: https.Server
let plainPort = 0
let securePort = 0
const listen = (s: net.Server): Promise<number> => new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port)))

beforeAll(async () => {
  plain = http.createServer(handler)
  secure = https.createServer({ key: (worldCerts as unknown as { leaf: { keyPem: string } }).leaf.keyPem, cert: worldCerts.certFor('localhost') + world.certPem }, handler)
  plainPort = await listen(plain)
  securePort = await listen(secure)
})
afterAll(() => {
  plain.close()
  secure.close()
})

interface Reply {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

function read(res: http.IncomingMessage): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    res.on('data', (b: Buffer) => chunks.push(b))
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
    res.on('error', reject)
  })
}

/** HTTP request through the proxy, the way a phone's HTTP stack sends it (absolute URL). */
function viaProxyHttp(proxyPort: number, path: string, method = 'GET', body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: proxyPort, method, path: `http://localhost:${plainPort}${path}`, headers: { host: `localhost:${plainPort}`, 'proxy-connection': 'keep-alive', 'content-type': 'application/json' }, agent: false },
      (res) => void read(res).then(resolve, reject)
    )
    req.on('error', reject)
    req.end(body)
  })
}

/** CONNECT tunnel through the proxy. */
function connect(proxyPort: number, authority: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: authority, agent: false })
    req.on('connect', (res, socket) => (res.statusCode === 200 ? resolve(socket) : reject(new Error(`CONNECT ${res.statusCode}`))))
    req.on('error', reject)
    req.end()
  })
}

/** HTTPS request through the proxy; `trust` is the CA the "app" trusts. */
async function viaProxyHttps(proxyPort: number, path: string, trust: string, method = 'GET', body?: string): Promise<Reply & { issuer: string }> {
  const socket = await connect(proxyPort, `localhost:${securePort}`)
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket, servername: 'localhost', ca: trust, ALPNProtocols: ['h2', 'http/1.1'] })
    t.on('error', (e) => {
      socket.destroy() // a real client drops the connection when it refuses the certificate
      reject(e)
    })
    t.on('secureConnect', () => {
      const issuer = new X509Certificate(t.getPeerCertificate(true).raw).issuer
      // Hand-written HTTP/1.1 over the encrypted socket: no client library in the way.
      const payload = Buffer.from(body ?? '')
      t.write(`${method} ${path} HTTP/1.1\r\nHost: localhost:${securePort}\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`)
      t.write(payload)
      const chunks: Buffer[] = []
      t.on('data', (b: Buffer) => chunks.push(b))
      t.on('end', () => {
        const all = Buffer.concat(chunks)
        const cut = all.indexOf('\r\n\r\n')
        if (cut < 0) return reject(new Error('no HTTP response: ' + all.toString().slice(0, 80)))
        const head = all.subarray(0, cut).toString().split('\r\n')
        const headers: http.IncomingHttpHeaders = {}
        for (const line of head.slice(1)) headers[line.slice(0, line.indexOf(':')).toLowerCase()] = line.slice(line.indexOf(':') + 1).trim()
        let payloadIn = all.subarray(cut + 4)
        if (headers['transfer-encoding'] === 'chunked') {
          const parts: Buffer[] = []
          for (let at = 0; ; ) {
            const eol = payloadIn.indexOf('\r\n', at)
            const size = parseInt(payloadIn.subarray(at, eol).toString(), 16)
            if (!size) break
            parts.push(payloadIn.subarray(eol + 2, eol + 2 + size))
            at = eol + 2 + size + 2
          }
          payloadIn = Buffer.concat(parts)
        }
        resolve({ status: Number(head[0].split(' ')[1]), headers, body: payloadIn, issuer })
      })
    })
  })
}

async function withProxy<T>(decrypt: boolean, run: (port: number, calls: () => NetCall[], infos: string[]) => Promise<T>): Promise<T> {
  const seen = new Map<string, NetCall>()
  const infos: string[] = []
  const proxy = new ProxyServer({ onCall: (c) => seen.set(c.id, { ...c }), onInfo: (m) => infos.push(m) }, { ca: decrypt ? proxyCa : undefined, upstreamCa: world.certPem })
  const port = await proxy.start()
  try {
    return await run(port, () => [...seen.values()], infos)
  } finally {
    await proxy.stop()
  }
}

const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20))
  expect(ok()).toBe(true)
}

describe('capturing proxy', () => {
  it('records a plain HTTP request and its answer, and strips proxy headers', async () => {
    await withProxy(false, async (port, calls) => {
      const r = await viaProxyHttp(port, '/api/login?x=1', 'POST', '{"user":"a"}')
      const echoed = JSON.parse(r.body.toString())
      expect(echoed).toMatchObject({ method: 'POST', url: '/api/login?x=1', body: '{"user":"a"}', via: null, host: `localhost:${plainPort}` })
      await until(() => calls().some((c) => c.durationMs !== undefined))
      const [c] = calls()
      expect(c).toMatchObject({ kind: 'http', source: 'proxy', method: 'POST', url: `http://localhost:${plainPort}/api/login?x=1`, status: 200, args: '{"user":"a"}' })
      expect(JSON.parse(c.result!)).toMatchObject({ url: '/api/login?x=1' })
      expect(c.reqHeaders?.some((h) => h.name.toLowerCase() === 'content-type')).toBe(true)
      expect(c.resHeaders?.some((h) => h.name.toLowerCase() === 'content-type')).toBe(true)
    })
  })

  it('keeps status codes, repeated headers, and shows compressed / binary bodies readably', async () => {
    await withProxy(false, async (port, calls) => {
      expect((await viaProxyHttp(port, '/missing')).status).toBe(404)
      expect((await viaProxyHttp(port, '/cookies')).headers['set-cookie']).toEqual(['a=1', 'b=2'])
      const gz = await viaProxyHttp(port, '/gzip')
      expect(JSON.parse(zlib.gunzipSync(gz.body).toString())).toEqual({ zipped: true }) // passed through untouched
      await viaProxyHttp(port, '/image')
      await until(() => calls().filter((c) => c.durationMs !== undefined).length === 4)
      const by = (p: string): NetCall => calls().find((c) => c.url.endsWith(p))!
      expect(by('/missing').status).toBe(404)
      expect(by('/gzip').result).toBe('{"zipped":true}')
      expect(by('/image').result).toBe('[dữ liệu nhị phân 8 byte, image/png]')
    })
  })

  it('without decryption: HTTPS still works end to end and only the host is recorded', async () => {
    await withProxy(false, async (port, calls) => {
      const r = await viaProxyHttps(port, '/secret?token=abc', world.certPem, 'POST', 'top-secret')
      expect(r.issuer).toContain('ADB Kit Proxy CA') // both test CAs carry this name…
      expect(JSON.parse(r.body.toString())).toMatchObject({ url: '/secret?token=abc', body: 'top-secret' }) // …but only the real server's chain was trusted
      await until(() => calls().some((c) => c.durationMs !== undefined))
      expect(calls()).toHaveLength(1)
      const [c] = calls()
      expect(c).toMatchObject({ method: 'CONNECT', url: `https://localhost:${securePort}/`, status: 200, resourceType: 'tunnel' })
      expect(JSON.stringify(c)).not.toMatch(/top-secret|token=abc/)
    })
  })

  it('with decryption: an app that trusts the CA gets the answer, and the call is recorded in full', async () => {
    await withProxy(true, async (port, calls) => {
      const r = await viaProxyHttps(port, '/api/profile', proxyCa.certPem, 'PUT', '{"name":"Hà"}')
      expect(r.status).toBe(200)
      expect(JSON.parse(r.body.toString())).toMatchObject({ method: 'PUT', url: '/api/profile', body: '{"name":"Hà"}' })
      await until(() => calls().some((c) => c.durationMs !== undefined))
      const c = calls().find((x) => x.method === 'PUT')!
      expect(c).toMatchObject({ url: `https://localhost:${securePort}/api/profile`, status: 200, args: '{"name":"Hà"}', resourceType: 'HTTPS' })
      expect(JSON.parse(c.result!).body).toBe('{"name":"Hà"}')
    })
  })

  it('with decryption: an app that does NOT trust the CA fails once, then is tunnelled untouched', async () => {
    await withProxy(true, async (port, calls, infos) => {
      await expect(viaProxyHttps(port, '/pinned', world.certPem)).rejects.toThrow() // our certificate is refused
      await until(() => infos.length > 0)
      expect(infos[0]).toContain('không tin chứng chỉ')
      const r = await viaProxyHttps(port, '/pinned', world.certPem) // same host, next attempt
      expect(JSON.parse(r.body.toString())).toMatchObject({ url: '/pinned' })
      await until(() => calls().some((c) => c.status === 200))
      expect(calls().some((c) => c.url.includes('/pinned'))).toBe(false) // never decrypted
      expect(calls().some((c) => c.status === 0 && /từ chối chứng chỉ/.test(c.error ?? ''))).toBe(true)
    })
  })

  it('passes a WebSocket upgrade through (plain and decrypted) and records it', async () => {
    const upgrade = (_req: http.IncomingMessage, socket: import('node:stream').Duplex): void => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
      socket.on('data', (d: Buffer) => socket.write(Buffer.concat([Buffer.from('echo:'), d])))
    }
    plain.on('upgrade', upgrade)
    secure.on('upgrade', upgrade)
    const talk = (sock: import('node:stream').Duplex, firstLine: string, host: string): Promise<string> =>
      new Promise((resolve, reject) => {
        let got = ''
        let sent = false
        sock.on('data', (b: Buffer) => {
          got += b.toString()
          if (!sent && got.includes('\r\n\r\n')) {
            sent = true
            sock.write('ping')
          }
          if (got.includes('echo:ping')) resolve(got)
        })
        sock.on('error', reject)
        sock.on('close', () => reject(new Error('closed: ' + got.slice(0, 60))))
        sock.write(`${firstLine}\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
      })
    await withProxy(true, async (port, calls) => {
      // ws:// — the client sends the absolute URL straight to the proxy.
      const raw = net.connect(port, '127.0.0.1')
      await new Promise((r) => raw.once('connect', r))
      expect(await talk(raw, `GET http://localhost:${plainPort}/socket?room=1 HTTP/1.1`, `localhost:${plainPort}`)).toMatch(/^HTTP\/1\.1 101/)
      raw.destroy()
      // wss:// — CONNECT, TLS with ADB Kit's certificate, then the upgrade inside.
      const tunnel = await connect(port, `localhost:${securePort}`)
      const t = tls.connect({ socket: tunnel, servername: 'localhost', ca: proxyCa.certPem })
      await new Promise((r, j) => (t.once('secureConnect', r), t.once('error', j)))
      expect(await talk(t, 'GET /socket HTTP/1.1', `localhost:${securePort}`)).toMatch(/^HTTP\/1\.1 101/)
      t.destroy()
      await until(() => calls().filter((c) => c.resourceType === 'WebSocket' && c.durationMs !== undefined).length === 2)
      const ws = calls().filter((c) => c.resourceType === 'WebSocket')
      expect(ws.map((c) => c.url).sort()).toEqual([`ws://localhost:${plainPort}/socket?room=1`, `wss://localhost:${securePort}/socket`])
      expect(ws.every((c) => c.status === 101)).toBe(true)
    })
  })

  it('reports a server that cannot be reached instead of hanging', async () => {
    await withProxy(false, async (port, calls) => {
      const dead = await listen(net.createServer()).then((p) => p) // a port nobody answers HTTP on
      const r = await new Promise<Reply>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: `http://127.0.0.1:1/x`, agent: false }, (res) => void read(res).then(resolve, reject))
        req.on('error', reject)
        req.end()
      })
      expect(dead).toBeGreaterThan(0)
      expect(r.status).toBe(502)
      await until(() => calls().some((c) => c.status === 0))
      expect(calls()[0].error).toBeTruthy()
    })
  })

  it('answers a browser that opens the proxy address directly', async () => {
    await withProxy(false, async (port) => {
      const r = await new Promise<Reply>((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/', agent: false }, (res) => void read(res).then(resolve, reject)).on('error', reject)
      })
      expect(r.status).toBe(400)
    })
  })

  it('issues per-host certificates that chain to the CA', () => {
    const store = new CertStore(proxyCa)
    const leaf = new X509Certificate(store.certFor('api.example.com'))
    const ca = new X509Certificate(proxyCa.certPem)
    expect(leaf.checkIssued(ca)).toBe(true)
    expect(leaf.verify(ca.publicKey)).toBe(true)
    expect(leaf.subjectAltName).toContain('DNS:api.example.com')
    expect(ca.ca).toBe(true)
    expect(new X509Certificate(store.certFor('10.0.0.5')).subjectAltName).toContain('IP Address:10.0.0.5')
    const lifeDays = (Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)) / 86_400_000
    expect(lifeDays).toBeLessThan(398)
  })

  it('parses CONNECT targets', () => {
    expect(parseAuthority('api.example.com:8443', 443)).toEqual({ host: 'api.example.com', port: 8443 })
    expect(parseAuthority('api.example.com', 443)).toEqual({ host: 'api.example.com', port: 443 })
    expect(parseAuthority('[::1]:443', 443)).toEqual({ host: '::1', port: 443 })
    expect(parseAuthority('', 443)).toBeNull()
    expect(parseAuthority('host:99999', 443)).toBeNull()
  })

  it('describes bodies: empty, text, cut, unknown compression', () => {
    const tap = (s: string | Buffer, total?: number): { bytes: Buffer; total: number; truncated: boolean } => {
      const bytes = Buffer.from(s)
      return { bytes, total: total ?? bytes.length, truncated: (total ?? bytes.length) > bytes.length }
    }
    expect(bodyText(tap(''), {})).toBeUndefined()
    expect(bodyText(tap('a=1&b=2'), { 'content-type': 'application/x-www-form-urlencoded' })).toBe('a=1&b=2')
    expect(bodyText(tap('abc', 1000), { 'content-type': 'text/plain' })).toContain('1000 byte')
    expect(bodyText(tap('xx'), { 'content-type': 'application/json', 'content-encoding': 'zstd' })).toBe('[nội dung nén zstd, 2 byte]')
    expect(bodyText(tap(Buffer.from([0, 1, 2, 3])), {})).toBe('[dữ liệu nhị phân 4 byte]')
  })
})
