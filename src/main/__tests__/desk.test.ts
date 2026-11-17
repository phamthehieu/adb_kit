import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AiSources, AiUsageReader } from '../aiUsage'
import { DeskServer } from '../desk'
import { DEFAULT_DESK, type DeskSnapshot } from '../../shared/desk'

const fetchText = (url: string): Promise<{ status: number; type: string; body: string }> =>
  new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body }))
    }).on('error', reject)
  })

describe('DeskServer', () => {
  let server: DeskServer | null = null
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('serves the page only to someone who knows the key', async () => {
    server = new DeskServer()
    const port = await server.start()
    const ok = await fetchText(`http://127.0.0.1:${port}/?k=${server.key}`)
    expect(ok.status).toBe(200)
    expect(ok.type).toContain('text/html')
    expect(ok.body).toContain('EventSource')
    expect((await fetchText(`http://127.0.0.1:${port}/`)).status).toBe(403)
    expect((await fetchText(`http://127.0.0.1:${port}/?k=wrong`)).status).toBe(403)
    expect((await fetchText(`http://127.0.0.1:${port}/nothing?k=${server.key}`)).status).toBe(404)
  })

  it('streams snapshots, the latest one first, and counts viewers', async () => {
    server = new DeskServer()
    const port = await server.start()
    const snap: DeskSnapshot = { t: 1, host: 'pc', cpu: 12, cores: 8, memUsed: 4, memTotal: 8 }
    server.send(snap, DEFAULT_DESK)
    const s = server
    const got = await new Promise<string[]>((resolve, reject) => {
      const seen: string[] = []
      const req = get(`http://127.0.0.1:${port}/events?k=${s.key}`, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream')
        res.on('data', (c) => {
          for (const m of String(c).matchAll(/^data: (.*)$/gm)) seen.push(m[1])
          if (seen.length === 1) {
            expect(s.viewers).toBe(1)
            s.send({ ...snap, cpu: 50 }, DEFAULT_DESK)
          }
          if (seen.length === 2) {
            req.destroy()
            resolve(seen)
          }
        })
      })
      req.on('error', (e) => (seen.length === 2 ? undefined : reject(e)))
    })
    expect(got.map((g) => JSON.parse(g).s.cpu)).toEqual([12, 50])
    expect(JSON.parse(got[0]).c).toEqual(DEFAULT_DESK)
  })

  it('refuses anything but GET', async () => {
    server = new DeskServer()
    const port = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/?k=${server.key}`, { method: 'POST', body: 'x' })
    expect(res.status).toBe(403)
  })
})

describe('AiUsageReader', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const rec = (id: string, t: number, out: number, session = 's1'): string =>
    JSON.stringify({ type: 'assistant', timestamp: new Date(t).toISOString(), requestId: `r-${id}`, sessionId: session, message: { id, usage: { input_tokens: 1, output_tokens: out } } }) + '\n'

  it('counts each reply once, picks up appended lines, and reads sub-agent logs', async () => {
    dir = mkdtempSync(join(tmpdir(), 'adbkit-ai-'))
    const now = new Date()
    now.setHours(12, 0, 0, 0)
    const t = now.getTime()
    mkdirSync(join(dir, 'proj', 'sess', 'subagents'), { recursive: true })
    const main = join(dir, 'proj', 'sess.jsonl')
    // The same reply logged twice while it streamed: the last record wins.
    writeFileSync(main, '{"type":"user","message":{"content":"hi"}}\n' + rec('a', t - 1000, 5) + rec('a', t - 1000, 20))
    writeFileSync(join(dir, 'proj', 'sess', 'subagents', 'agent.jsonl'), rec('b', t - 2000, 7, 's2'))
    writeFileSync(join(dir, 'proj', 'notes.txt'), rec('zzz', t, 999))

    const r = new AiUsageReader(dir)
    const first = await r.read(t)
    expect(first.today.output).toBe(27)
    expect(first.today.messages).toBe(2)
    expect(first.active).toBe(2)

    // A half-written line must wait for its newline.
    const next = rec('c', t, 100)
    appendFileSync(main, next.slice(0, 40))
    expect((await r.read(t)).today.output).toBe(27)
    appendFileSync(main, next.slice(40))
    const third = await r.read(t)
    expect(third.today.output).toBe(127)
    expect(third.today.messages).toBe(3)
  })

  it('reads Antigravity conversations once each and lists only the tools found on the PC', async () => {
    dir = mkdtempSync(join(tmpdir(), 'adbkit-ai-'))
    const now = new Date()
    now.setHours(12, 0, 0, 0)
    const t = now.getTime()
    const step = (i: number, out: number): string => JSON.stringify({ step_index: i, type: 'PLANNER_RESPONSE', created_at: new Date(t - 1000).toISOString(), input_tokens: 10, cache_read_tokens: 500, output_tokens: out, content: 'secret' }) + '\n'
    const logs = join(dir, 'ag', 'conv-1', '.system_generated', 'logs')
    mkdirSync(join(logs, 'chunks', 'transcript'), { recursive: true })
    writeFileSync(join(logs, 'transcript.jsonl'), '{"step_index":0,"type":"USER_INPUT"}\n' + step(1, 5) + step(2, 6))
    // The same steps again in the files next to it must not be counted twice.
    writeFileSync(join(logs, 'transcript_full.jsonl'), step(1, 5) + step(2, 6))
    writeFileSync(join(logs, 'chunks', 'transcript', 'a.jsonl'), step(1, 5))
    mkdirSync(join(dir, 'ag', 'conv-2'), { recursive: true }) // a conversation without logs yet

    const found = await new AiSources({ claude: join(dir, 'no-claude'), antigravity: join(dir, 'ag') }).read(t)
    expect(found.map((f) => f.id)).toEqual(['antigravity'])
    expect(found[0].usage.today).toEqual({ input: 20, output: 11, cacheRead: 1000, cacheWrite: 0, messages: 2 })
    expect(found[0].usage.active).toBe(1)
    expect(await new AiSources({ claude: join(dir, 'no-claude'), antigravity: join(dir, 'no-ag') }).read(t)).toEqual([])
  })

  it('returns zeros when Claude Code was never used on this PC', async () => {
    dir = mkdtempSync(join(tmpdir(), 'adbkit-ai-'))
    const u = await new AiUsageReader(join(dir, 'missing')).read()
    expect(u.today.messages).toBe(0)
    expect(u.active).toBe(0)
  })
})
