// Token usage of the AI coding tools on this PC, read from the logs they keep locally:
//   Claude Code   ~/.claude/projects/**/*.jsonl
//   Antigravity   ~/.gemini/antigravity/brain/<conversation>/.system_generated/logs/transcript.jsonl
// Nothing is sent anywhere and only the counters of each reply are kept: the text of the
// conversations is never stored or shown.
import { createReadStream, existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { RECENT_MS, parseAntigravityLine, parseUsageLine, sumUsage, type AiSourceUsage, type AiUsage, type UsageEvent } from '../shared/desk'

export const claudeLogRoot = (): string => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
export const antigravityLogRoot = (): string => join(homedir(), '.gemini', 'antigravity', 'brain')

const dayStartOf = (now: number): number => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

interface LogFile {
  file: string
  /** Passed to the parser (the conversation a file belongs to, when the lines do not say). */
  tag: string
}

async function listJsonl(dir: string, depth: number, out: LogFile[]): Promise<void> {
  let names: import('node:fs').Dirent[]
  try {
    names = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const n of names) {
    const p = join(dir, n.name)
    if (n.isDirectory()) {
      if (depth < 4) await listJsonl(p, depth + 1, out)
    } else if (n.name.endsWith('.jsonl')) out.push({ file: p, tag: '' })
  }
}

/** Every session log of Claude Code, sub-agents included. */
export async function claudeLogs(root: string): Promise<LogFile[]> {
  const out: LogFile[] = []
  await listJsonl(root, 0, out)
  return out
}

/** One transcript per Antigravity conversation (the chunk files next to it repeat the same steps). */
export async function antigravityLogs(root: string): Promise<LogFile[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  return names.map((id) => ({ file: join(root, id, '.system_generated', 'logs', 'transcript.jsonl'), tag: id }))
}

/** Read the complete lines of `file` from byte `start`; returns the offset after the last one. */
function readLines(file: string, start: number, onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    let rest: Buffer = Buffer.alloc(0)
    let done = start
    const s = createReadStream(file, { start })
    s.on('data', (chunk) => {
      let buf = rest.length ? Buffer.concat([rest, chunk as Buffer]) : (chunk as Buffer)
      for (;;) {
        const nl = buf.indexOf(10)
        if (nl < 0) break
        onLine(buf.toString('utf8', 0, nl))
        done += nl + 1
        buf = buf.subarray(nl + 1)
      }
      rest = buf
    })
    s.on('error', () => resolve(done))
    s.on('end', () => resolve(done))
  })
}

export class AiUsageReader {
  private offsets = new Map<string, number>()
  private events = new Map<string, UsageEvent>()
  private busy = false

  constructor(
    private root = claudeLogRoot(),
    private list: (root: string) => Promise<LogFile[]> = claudeLogs,
    private parse: (line: string, tag: string) => UsageEvent | null = parseUsageLine
  ) {}

  /** Read what was appended since the last call and return the totals. */
  async read(now = Date.now()): Promise<AiUsage> {
    const dayStart = dayStartOf(now)
    const since = Math.min(dayStart, now - RECENT_MS)
    if (!this.busy) {
      this.busy = true
      try {
        for (const { file, tag } of await this.list(this.root)) {
          let st: import('node:fs').Stats
          try {
            st = await stat(file)
          } catch {
            continue
          }
          if (st.mtimeMs < since) continue
          let from = this.offsets.get(file) ?? 0
          if (st.size < from) from = 0 // rewritten
          if (st.size === from) continue
          const end = await readLines(file, from, (line) => {
            const e = this.parse(line, tag)
            // A reply is logged again as it grows: the last record has the final counters.
            if (e && e.t >= since) this.events.set(e.id, e)
          })
          this.offsets.set(file, end)
        }
        for (const [id, e] of this.events) if (e.t < since) this.events.delete(id)
      } finally {
        this.busy = false
      }
    }
    return sumUsage(this.events.values(), now, dayStart)
  }
}

/** The AI tools that keep usage logs on this PC (a tool that was never used here is left out). */
export class AiSources {
  private readers: { id: string; name: string; reader: AiUsageReader }[] = []

  constructor(roots: { claude?: string; antigravity?: string } = {}) {
    const claude = roots.claude ?? claudeLogRoot()
    const antigravity = roots.antigravity ?? antigravityLogRoot()
    if (existsSync(claude)) this.readers.push({ id: 'claude', name: 'Claude Code', reader: new AiUsageReader(claude) })
    if (existsSync(antigravity)) this.readers.push({ id: 'antigravity', name: 'Antigravity', reader: new AiUsageReader(antigravity, antigravityLogs, parseAntigravityLine) })
  }

  async read(now = Date.now()): Promise<AiSourceUsage[]> {
    const out: AiSourceUsage[] = []
    for (const r of this.readers) out.push({ id: r.id, name: r.name, usage: await r.reader.read(now) })
    return out
  }
}
