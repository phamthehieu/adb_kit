import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import type { ApiProbeRun, ApiRequest, ApiResponse } from '../shared/apilab'
import { pathOf } from '../shared/reqapi'
import { writeKbkt, type KbktCase } from './kbkt'

const MAX_BODY = 200_000

function decompress(buf: Buffer, encoding?: string): Buffer {
  try {
    const e = (encoding ?? '').toLowerCase().trim()
    if (e === 'gzip' || e === 'x-gzip') return gunzipSync(buf)
    if (e === 'deflate') return inflateSync(buf)
    if (e === 'br') return brotliDecompressSync(buf)
  } catch {
    /* return raw buffer if decompression fails */
  }
  return buf
}

/**
 * Send an HTTP/HTTPS request directly from the main process.
 * Staging / UAT servers frequently use self-signed certificates (`rejectUnauthorized: false`).
 */
export function sendApiRequest(req: ApiRequest, redirectsLeft = 3): Promise<ApiResponse> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(req.url)
    } catch (e) {
      return resolve({
        ok: false,
        status: 0,
        statusText: '',
        durationMs: 0,
        headers: [],
        body: '',
        size: 0,
        error: `URL không hợp lệ: ${(e as Error).message}`
      })
    }

    const isHttps = parsedUrl.protocol === 'https:'
    const fn = isHttps ? httpsRequest : httpRequest
    const method = (req.method || 'GET').toUpperCase()
    const headersObj: Record<string, string> = {
      'Accept-Encoding': 'gzip, deflate, br'
    }
    for (const h of req.headers) {
      if (h.enabled && h.name.trim()) {
        headersObj[h.name.trim()] = h.value
      }
    }

    const hasBody = !/^(GET|HEAD)$/i.test(method) && req.body.length > 0
    const bodyBuf = hasBody ? Buffer.from(req.body, 'utf8') : null
    if (bodyBuf) {
      headersObj['Content-Length'] = String(bodyBuf.byteLength)
    }

    const timeoutMs = Math.max(1000, Math.min(60_000, req.timeoutMs ?? 20_000))

    const clientReq = fn(
      parsedUrl,
      {
        method,
        headers: headersObj,
        timeout: timeoutMs,
        ...(isHttps ? { rejectUnauthorized: false } : {})
      },
      (res) => {
        const status = res.statusCode ?? 0
        const loc = res.headers.location
        if ([301, 302, 303, 307, 308].includes(status) && loc && redirectsLeft > 0) {
          res.resume()
          const nextUrl = new URL(loc, parsedUrl).toString()
          const nextMethod = status === 303 ? 'GET' : method
          const nextBody = status === 303 ? '' : req.body
          void sendApiRequest({ ...req, method: nextMethod, url: nextUrl, body: nextBody }, redirectsLeft - 1).then(resolve)
          return
        }

        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (chunk: Buffer) => {
          total += chunk.byteLength
          if (total <= MAX_BODY * 2) chunks.push(chunk)
        })
        res.on('end', () => {
          const durationMs = Date.now() - t0
          const raw = decompress(Buffer.concat(chunks), res.headers['content-encoding'])
          let body = raw.toString('utf8')
          if (body.length > MAX_BODY) {
            body = `${body.slice(0, MAX_BODY)}… (${body.length} ký tự)`
          }
          const headers: { name: string; value: string }[] = []
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers.push({ name: k, value: Array.isArray(v) ? v.join(', ') : String(v) })
          }
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            durationMs,
            headers,
            body,
            size: total
          })
        })
      }
    )

    clientReq.on('timeout', () => {
      clientReq.destroy(new Error(`Quá thời gian chờ (${Math.round(timeoutMs / 1000)}s)`))
    })

    clientReq.on('error', (err) => {
      resolve({
        ok: false,
        status: 0,
        statusText: '',
        durationMs: Date.now() - t0,
        headers: [],
        body: '',
        size: 0,
        error: err.message
      })
    })

    if (bodyBuf) clientReq.write(bodyBuf)
    clientReq.end()
  })
}

/** Export executed API probe runs directly into a KBKT Excel file with Pass/Fail results filled in. */
export async function exportApiProbeKbkt(
  templatePath: string,
  outPath: string,
  meta: { title: string; code: string; author: string },
  runs: ApiProbeRun[]
): Promise<string> {
  const cases: KbktCase[] = runs.map((r) => {
    const p = r.probe
    const group = `API: ${p.req.method} ${pathOf(p.req.url)}`
    const snippet = r.res.body ? r.res.body.replace(/\s+/g, ' ').slice(0, 180) : ''
    const note = `${r.reason}${snippet ? `\nPhản hồi: ${snippet}` : ''}`
    return {
      group,
      purpose: p.purpose,
      steps: `1. Gửi request ${p.req.method} ${pathOf(p.req.url)}\n2. Tham số: ${p.dataLabel}\n3. Kiểm tra HTTP status và phản hồi của Server`,
      data: p.dataLabel,
      expected: p.expectedText,
      results: [r.status],
      note
    }
  })

  await writeKbkt(templatePath, outPath, {
    title: meta.title || 'Kiểm thử API',
    code: meta.code || 'API_TC',
    author: meta.author,
    tester: meta.author,
    cases
  })
  return outPath
}
