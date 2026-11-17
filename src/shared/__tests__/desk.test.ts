import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_DESK, DESK_APP, cpuPercent, fmtRate, fmtTokens, installedVersion, netRate, normalizeDesk, normalizeRepo, parseAntigravityLine, parseCiRuns, parseProcNetDev, parseSysLine, parseUsageLine, screenCenter, sumUsage, type UsageEvent } from '../desk'

const line = (o: Record<string, unknown>): string => JSON.stringify(o)
const reply = (over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}): string =>
  line({
    type: 'assistant',
    timestamp: '2026-11-17T04:09:02.939Z',
    requestId: 'req_1',
    sessionId: 's1',
    message: { id: 'msg_1', content: [{ type: 'text', text: 'secret words' }], usage: { input_tokens: 2, output_tokens: 155, cache_read_input_tokens: 30579, cache_creation_input_tokens: 23274, ...usage } },
    ...over
  })

describe('parseUsageLine', () => {
  it('reads the counters of a model reply and nothing else', () => {
    const e = parseUsageLine(reply())!
    expect(e).toEqual({ id: 'msg_1|req_1', session: 's1', t: Date.parse('2026-11-17T04:09:02.939Z'), input: 2, output: 155, cacheRead: 30579, cacheWrite: 23274 })
    expect(JSON.stringify(e)).not.toContain('secret')
  })

  it('ignores lines that are not model replies', () => {
    expect(parseUsageLine(line({ type: 'user', message: { content: 'the word "usage" and "assistant" in text' } }))).toBeNull()
    expect(parseUsageLine(line({ type: 'assistant', timestamp: '2026-11-17T04:09:02Z', message: { id: 'm' } }))).toBeNull()
    expect(parseUsageLine('{"type":"assistant","usage" broken')).toBeNull()
    expect(parseUsageLine('')).toBeNull()
  })

  it('needs a time and an id, and treats odd counters as zero', () => {
    expect(parseUsageLine(reply({ timestamp: 'nope' }))).toBeNull()
    expect(parseUsageLine(reply({ requestId: undefined, message: { usage: { output_tokens: 1 } } }))).toBeNull()
    const e = parseUsageLine(reply({}, { input_tokens: -5, output_tokens: 'many', cache_read_input_tokens: null }))!
    expect([e.input, e.output, e.cacheRead]).toEqual([0, 0, 0])
  })
})

describe('parseAntigravityLine', () => {
  const step = (over: Record<string, unknown> = {}): string =>
    line({ step_index: 7, type: 'PLANNER_RESPONSE', created_at: '2026-11-17T04:09:02Z', input_tokens: 120, cache_read_tokens: 9000, output_tokens: 40, content: 'secret words', ...over })

  it('reads the counters of a model step, keyed by conversation and step', () => {
    const e = parseAntigravityLine(step(), 'conv')!
    expect(e).toEqual({ id: 'conv|7', session: 'conv', t: Date.parse('2026-11-17T04:09:02Z'), input: 120, output: 40, cacheRead: 9000, cacheWrite: 0 })
    expect(JSON.stringify(e)).not.toContain('secret')
  })

  it('ignores steps without counters, a step number or a time', () => {
    expect(parseAntigravityLine(line({ step_index: 1, type: 'USER_INPUT', content: 'mentions "input_tokens" in text' }), 'c')).toBeNull()
    expect(parseAntigravityLine(step({ step_index: undefined }), 'c')).toBeNull()
    expect(parseAntigravityLine(step({ created_at: 'soon' }), 'c')).toBeNull()
    expect(parseAntigravityLine('{"input_tokens": broken', 'c')).toBeNull()
  })
})

describe('sumUsage', () => {
  const now = Date.parse('2026-11-17T10:00:00Z')
  const day = Date.parse('2026-11-17T00:00:00Z')
  const ev = (id: string, t: number, session = 's1'): UsageEvent => ({ id, session, t, input: 1, output: 10, cacheRead: 100, cacheWrite: 1000 })

  it('splits today from the last five hours and counts running sessions', () => {
    const u = sumUsage([ev('a', now - 60_000), ev('b', now - 2 * 60_000, 's2'), ev('c', now - 6 * 3600_000), ev('d', day - 3600_000)], now, day)
    expect(u.today).toEqual({ input: 3, output: 30, cacheRead: 300, cacheWrite: 3000, messages: 3 })
    expect(u.recent.messages).toBe(2)
    expect(u.active).toBe(2)
  })

  it('counts last night in "five hours" just after midnight, and skips records from the future', () => {
    const early = day + 3600_000
    const u = sumUsage([ev('a', day - 3600_000), ev('f', early + 3600_000)], early, day)
    expect(u.today.messages).toBe(0)
    expect(u.recent.messages).toBe(1)
    expect(u.active).toBe(0)
  })
})

describe('cpuPercent', () => {
  it('is the busy share between two readings', () => {
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 175, total: 300 })).toBe(25)
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 300 })).toBe(100)
  })
  it('is undefined when no time passed and never leaves 0–100', () => {
    expect(cpuPercent({ idle: 1, total: 2 }, { idle: 1, total: 2 })).toBeUndefined()
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 150, total: 100 })).toBe(0)
  })
})

describe('fmtTokens', () => {
  it('shortens big numbers the Vietnamese way', () => {
    expect([0, 950, 1000, 12_400, 10_000, 250_000, 3_250_000, 120_000_000, 2_500_000_000].map(fmtTokens)).toEqual(['0', '950', '1K', '12,4K', '10K', '250K', '3,25M', '120M', '2,5B'])
  })
  it('still works after being turned into page source', () => {
    const fn = new Function(`return (${fmtTokens.toString()})`)() as (n: number) => string
    expect(fn(12_400)).toBe('12,4K')
  })
})

describe('normalizeDesk', () => {
  it('fills what is missing and keeps brightness in range', () => {
    expect(normalizeDesk(null)).toEqual(DEFAULT_DESK)
    expect(normalizeDesk({ widgets: { clock: false, gpu: 'yes' } as never, dim: 5, autoFull: false, via: 'browser', sleepOnQuit: false, ciRepo: 'https://github.com/a/b.git' })).toEqual({
      widgets: { ...DEFAULT_DESK.widgets, clock: false },
      ciRepo: 'a/b',
      dim: 30,
      autoFull: false,
      via: 'browser',
      sleepOnQuit: false
    })
    expect(normalizeDesk({ dim: Number.NaN }).dim).toBe(100)
    expect(normalizeDesk({ via: 'telnet' as never }).via).toBe('app')
  })
})

describe('normalizeRepo', () => {
  it('accepts owner/repo and GitHub links, refuses the rest', () => {
    expect(normalizeRepo(' facebook/react ')).toBe('facebook/react')
    expect(normalizeRepo('https://github.com/owner/my.repo/actions?x=1')).toBe('owner/my.repo')
    expect(normalizeRepo('github.com/owner/repo.git')).toBe('owner/repo')
    expect(['', 'just-a-name', 'a/b/c d', 'https://evil.example/a/b', '../x', 42].map(normalizeRepo)).toEqual(['', '', '', '', '', ''])
  })
})

describe('helper output', () => {
  it('keeps the well-formed parts of a line and clamps percentages', () => {
    const s = parseSysLine('{"net":{"rx":10,"tx":5},"gpu":{"load":140,"name":"X"},"battery":{"level":87,"charging":true},"media":{"title":"T","artist":"A","playing":true,"position":12.5,"duration":200}}')!
    expect(s).toEqual({ net: { rx: 10, tx: 5 }, gpu: { name: 'X', load: 100 }, battery: { level: 87, charging: true }, media: { title: 'T', artist: 'A', playing: true, position: 12.5, duration: 200 } })
  })

  it('drops what is missing or malformed', () => {
    expect(parseSysLine('{}')).toEqual({})
    expect(parseSysLine('{"net":{"rx":"1","tx":2},"gpu":{"name":"X"},"battery":null,"media":{"title":""}}')).toEqual({})
    expect(parseSysLine('{"media":{"title":"T","position":-3}}')).toEqual({ media: { title: 'T', artist: '', playing: false, position: 0, duration: 0 } })
    expect(parseSysLine('WARNING: something')).toBeNull()
    expect(parseSysLine('[1,2]')).toEqual({})
  })
})

describe('network speed', () => {
  it('is the difference per second, and nothing when a counter went backwards', () => {
    expect(netRate({ rx: 1000, tx: 500 }, { rx: 3000, tx: 500 }, 2000)).toEqual({ down: 1000, up: 0 })
    expect(netRate({ rx: 1000, tx: 500 }, { rx: 10, tx: 600 }, 2000)).toBeUndefined()
    expect(netRate({ rx: 1, tx: 1 }, { rx: 2, tx: 2 }, 0)).toBeUndefined()
  })

  it('reads Linux /proc/net/dev without loopback', () => {
    const text = [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo:  999999    100    0    0    0     0          0         0   999999    100    0    0    0     0       0          0',
      '  eth0: 1000    10    0    0    0     0          0         0     200     5    0    0    0     0       0          0',
      'wlan0:5000 20 0 0 0 0 0 0 700 9 0 0 0 0 0 0'
    ].join('\n')
    expect(parseProcNetDev(text)).toEqual({ rx: 6000, tx: 900 })
    expect(parseProcNetDev('nothing here')).toBeNull()
  })

  it('formats speeds', () => {
    expect([0, 2300, 1_300_000, 150 * 1048576, 2 * 1073741824 * 1].map(fmtRate)).toEqual(['0 KB/s', '2 KB/s', '1,2 MB/s', '150 MB/s', '2,0 GB/s'])
    const fn = new Function(`return (${fmtRate.toString()})`)() as (n: number) => string
    expect(fn(1_300_000)).toBe('1,2 MB/s')
  })
})

describe('parseCiRuns', () => {
  const run = (over: Record<string, unknown>): unknown => ({ workflow_runs: [{ name: 'Release', display_title: 'feat: x', head_branch: 'master', status: 'completed', conclusion: 'success', updated_at: '2026-11-17T05:00:00Z', ...over }, { name: 'old' }] })

  it('reads the newest run', () => {
    expect(parseCiRuns(run({}), 'a/b')).toEqual({ repo: 'a/b', state: 'success', name: 'Release', title: 'feat: x', branch: 'master', at: Date.parse('2026-11-17T05:00:00Z') })
  })

  it('maps every status to one of six states', () => {
    const state = (o: Record<string, unknown>): string => parseCiRuns(run(o), 'a/b')!.state
    expect(state({ status: 'in_progress', conclusion: null })).toBe('running')
    expect(state({ status: 'queued', conclusion: null })).toBe('queued')
    expect(state({ conclusion: 'failure' })).toBe('failure')
    expect(state({ conclusion: 'timed_out' })).toBe('failure')
    expect(state({ conclusion: 'cancelled' })).toBe('cancelled')
    expect(state({ conclusion: 'skipped' })).toBe('other')
  })

  it('is null when the repository has no runs or the answer is not what we expect', () => {
    expect(parseCiRuns({ workflow_runs: [] }, 'a/b')).toBeNull()
    expect(parseCiRuns({ message: 'Not Found' }, 'a/b')).toBeNull()
    expect(parseCiRuns(null, 'a/b')).toBeNull()
  })
})

describe('viewer app', () => {
  it('reads the installed version from dumpsys', () => {
    expect(installedVersion('Packages:\n  Package [dev.adbkit.desk] (1a2b):\n    versionCode=3 minSdk=21 targetSdk=35\n')).toBe(3)
    expect(installedVersion('Unable to find package: dev.adbkit.desk')).toBeNull()
    expect(installedVersion('')).toBeNull()
  })

  it('matches the manifest the APK is built from', () => {
    const manifest = readFileSync(join(__dirname, '..', '..', '..', 'android', 'desk', 'AndroidManifest.xml'), 'utf8')
    expect(manifest).toContain(`package="${DESK_APP.pkg}"`)
    expect(manifest).toContain(`android:versionCode="${DESK_APP.versionCode}"`)
    expect(DESK_APP.activity).toBe(`${DESK_APP.pkg}/.MainActivity`)
  })
})

describe('screenCenter', () => {
  it('uses the override size when the phone has one', () => {
    expect(screenCenter('Physical size: 1440x2960\n')).toEqual({ x: 720, y: 1480 })
    expect(screenCenter('Physical size: 1440x2960\nOverride size: 1080x2220\n')).toEqual({ x: 540, y: 1110 })
    expect(screenCenter('error: no display')).toBeNull()
  })
})
