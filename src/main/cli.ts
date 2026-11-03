import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listDevices } from './adb'
import { Runner } from './runner'
import { SuiteRunner, readScript, readSuite } from './suite'
import { DEFAULT_RUN_OPTIONS, describeStep, type RunEvent, type RunOptions, type SuiteEvent } from '../shared/automation'

export interface CliArgs {
  file: string
  serial?: string
  out?: string
  video: boolean
}

/** `--run <file> [--serial X] [--out dir] [--no-video]` → parsed args, or null when not a CLI run. */
export function parseCli(argv: string[]): CliArgs | null {
  const i = argv.indexOf('--run')
  if (i < 0) return null
  const val = (k: string): string | undefined => {
    const j = argv.indexOf(k)
    return j >= 0 ? argv[j + 1] : undefined
  }
  return { file: argv[i + 1] ?? '', serial: val('--serial'), out: val('--out'), video: !argv.includes('--no-video') }
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
    const file = resolve(a.file)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { kind?: string }
    const devices = (await listDevices()).filter((d) => d.state === 'device')
    const serial = a.serial ?? devices[0]?.serial
    if (!serial) throw new Error('không có thiết bị nào sẵn sàng (adb devices)')
    if (a.serial && !devices.some((d) => d.serial === a.serial)) throw new Error(`thiết bị ${a.serial} không sẵn sàng`)
    const root = a.out ? resolve(a.out) : reportsRoot
    const opts: RunOptions = { ...DEFAULT_RUN_OPTIONS, recordVideo: a.video }
    out(`ADB Kit — chạy ${file} trên ${serial}`)

    if (raw.kind === 'adbkit-suite') {
      const suite = readSuite(file)
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
