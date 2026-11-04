import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listDevices } from './adb'
import { Runner } from './runner'
import { SuiteRunner, readScript, readSuite } from './suite'
import { DEFAULT_RUN_OPTIONS, describeStep, type FreshMode, type FreshPerms, type RunEvent, type RunOptions, type SuiteEvent } from '../shared/automation'

export interface CliArgs {
  file: string
  serial?: string
  out?: string
  video: boolean
  /** App state before every case / run (overrides the file): off | stop | clear. */
  fresh?: FreshMode
  /** Runtime permissions at that moment: keep | all | none. */
  perms?: FreshPerms
  /** A bad value for --fresh / --perms (reported when the run starts). */
  bad?: string
}

const FRESH_VALUES: FreshMode[] = ['off', 'stop', 'clear']
const PERMS_VALUES: FreshPerms[] = ['keep', 'all', 'none']

/** `--run <file> [--serial X] [--out dir] [--no-video] [--fresh off|stop|clear] [--perms keep|all|none]` → parsed args, or null when not a CLI run. */
export function parseCli(argv: string[]): CliArgs | null {
  const i = argv.indexOf('--run')
  if (i < 0) return null
  const val = (k: string): string | undefined => {
    const j = argv.indexOf(k)
    return j >= 0 ? argv[j + 1] : undefined
  }
  const fresh = val('--fresh')
  const perms = val('--perms')
  const bad =
    fresh !== undefined && !FRESH_VALUES.includes(fresh as FreshMode)
      ? `--fresh phải là ${FRESH_VALUES.join(' | ')} (nhận "${fresh}")`
      : perms !== undefined && !PERMS_VALUES.includes(perms as FreshPerms)
        ? `--perms phải là ${PERMS_VALUES.join(' | ')} (nhận "${perms}")`
        : undefined
  return {
    file: argv[i + 1] ?? '',
    serial: val('--serial'),
    out: val('--out'),
    video: !argv.includes('--no-video'),
    fresh: fresh as FreshMode | undefined,
    perms: perms as FreshPerms | undefined,
    bad
  }
}

const out = (s: string): void => {
  process.stdout.write(s + '\n')
}

/**
 * Headless run for CI / scheduled jobs. Exit code: 0 = all passed, 1 = failures,
 * 2 = could not run (bad file, no device…). A machine-readable ket-qua.json is written
 * next to the reports.
 */
export async function runCli(a: CliArgs, reportsRoot: string, templatePath: string): Promise<number> {
  try {
    if (!a.file) throw new Error('thiếu đường dẫn: --run <kịch bản hoặc bộ test .json>')
    if (a.bad) throw new Error(a.bad)
    const file = resolve(a.file)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { kind?: string }
    const devices = (await listDevices()).filter((d) => d.state === 'device')
    const serial = a.serial ?? devices[0]?.serial
    if (!serial) throw new Error('không có thiết bị nào sẵn sàng (adb devices)')
    if (a.serial && !devices.some((d) => d.serial === a.serial)) throw new Error(`thiết bị ${a.serial} không sẵn sàng`)
    const root = a.out ? resolve(a.out) : reportsRoot
    const opts: RunOptions = { ...DEFAULT_RUN_OPTIONS, recordVideo: a.video, fresh: a.fresh, freshPerms: a.perms }
    out(`ADB Kit — chạy ${file} trên ${serial}`)

    if (raw.kind === 'adbkit-suite') {
      const suite = readSuite(file)
      if (a.fresh) suite.fresh = a.fresh // the command line wins over the file
      if (a.perms) suite.freshPerms = a.perms
      let titles: string[] = []
      let end: Extract<SuiteEvent, { kind: 'end' }> | null = null
      const s = new SuiteRunner(serial, suite, opts, () => null, (e) => {
        if (e.kind === 'start') titles = e.cases.map((c) => c.title)
        else if (e.kind === 'case' && e.state !== 'running')
          out(`  [${e.state === 'passed' ? 'ĐẠT' : e.state === 'stopped' ? 'DỪNG' : 'LỖI'}] ${titles[e.index] ?? e.index}${e.attempt > 1 ? ` (lần ${e.attempt})` : ''}${e.state !== 'passed' && e.message ? ` — ${e.message}` : ''}`)
        else if (e.kind === 'end') end = e
      }, root, templatePath)
      await s.run()
      const r = end as Extract<SuiteEvent, { kind: 'end' }> | null
      if (!r) throw new Error('bộ test không kết thúc')
      if (r.error && !r.total) throw new Error(r.error)
      out(`Kết quả: ${r.passed} đạt, ${r.failed} lỗi / ${r.total} testcase`)
      out(`Báo cáo: ${r.html}`)
      if (r.xlsx) out(`KBKT:    ${r.xlsx}`)
      writeFileSync(join(s.dir, 'ket-qua.json'), JSON.stringify({ ...r, kind: 'suite', serial }, null, 2))
      return r.failed > 0 || r.passed < r.total ? 1 : 0
    }

    const script = readScript(file)
    let result = 'failed'
    let message = ''
    let report = ''
    const runner = new Runner(serial, script, opts, () => null, (e: RunEvent) => {
      if (e.kind === 'step' && e.state === 'failed') out(`  [LỖI] bước ${e.index + 1}: ${describeStep(script.steps[e.index])} — ${e.message ?? ''}`)
      else if (e.kind === 'crash') out(`  [${e.type.toUpperCase()}] ${e.pkg}: ${e.summary}`)
      else if (e.kind === 'end') {
        result = e.result
        message = e.message
      } else if (e.kind === 'report') report = e.path
    }, root)
    await runner.run()
    out(`Kết quả: ${result === 'passed' ? 'ĐẠT' : result.toUpperCase()} — ${message}`)
    out(`Báo cáo: ${report}`)
    writeFileSync(join(runner.dir, 'ket-qua.json'), JSON.stringify({ kind: 'script', result, message, report, serial }, null, 2))
    return result === 'passed' ? 0 : 1
  } catch (e) {
    out(`Không chạy được: ${(e as Error).message}`)
    return 2
  }
}
