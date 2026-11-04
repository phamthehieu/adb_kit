import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Circle,
  CircleCheck,
  CircleX,
  Copy,
  Crosshair,
  FilePlus2,
  FileText,
  FolderOpen,
  Loader2,
  Play,
  Save,
  Square,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import {
  DEFAULT_RUN_OPTIONS,
  PERF_LABEL,
  PERF_UNIT,
  describeStep,
  destructiveSteps,
  freshRisk,
  emptyScript,
  expectedOf,
  nodeAt,
  selectorFor,
  selectorLabel,
  type MatchMode,
  type MockRule,
  type RunEvent,
  type RunOptions,
  type Script,
  type Selector,
  type Step,
  type UiNode
} from '@shared/automation'
import { Key } from '@shared/control'
import { autoStore, onInspect, onMasksDone, onRecord, useAutoState } from '../lib/automation'
import { PackagePicker } from './PackagePicker'
import { SuitePanel } from './SuitePanel'
import { ExplorePanel } from './ExplorePanel'
import { PaneHandle } from './PaneHandle'
import { FreshOptions } from './FreshOptions'

type StepState = { state: 'running' | 'ok' | 'failed' | 'warn'; message?: string }
type LogLine = { level: 'info' | 'warn' | 'error' | 'ok'; message: string; at: string }

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? { ...fallback, ...JSON.parse(v) } : fallback
  } catch {
    return fallback
  }
}

/** Append a recorded step, merging typing / scrolling and inserting pauses as waits. */
function appendRecorded(steps: Step[], step: Step, gapMs: number): Step[] {
  const out = [...steps]
  const last = out[out.length - 1]
  if (step.type === 'text' && last?.type === 'text' && gapMs < 1500) {
    out[out.length - 1] = { ...last, text: last.text + step.text }
    return out
  }
  if (
    step.type === 'scroll' &&
    last?.type === 'scroll' &&
    gapMs < 800 &&
    Math.sign(last.dy) === Math.sign(step.dy) &&
    Math.abs(last.x - step.x) < 0.05 &&
    Math.abs(last.y - step.y) < 0.05
  ) {
    out[out.length - 1] = { ...last, dy: last.dy + step.dy }
    return out
  }
  if (out.length && gapMs > 400) out.push({ type: 'wait', ms: Math.min(10_000, Math.round(gapMs / 100) * 100) })
  out.push(step)
  return out
}

const ADDABLE: { key: string; label: string; make: (app: string) => Step }[] = [
  { key: 'launch', label: 'Mở app', make: (app) => ({ type: 'launch', pkg: app, clear: false }) },
  { key: 'stopApp', label: 'Tắt hẳn app', make: (app) => ({ type: 'stopApp', pkg: app }) },
  { key: 'wait', label: 'Chờ (ms)', make: () => ({ type: 'wait', ms: 1000 }) },
  { key: 'waitFor', label: 'Chờ chữ xuất hiện', make: () => ({ type: 'waitFor', target: { text: '' }, timeoutMs: 10_000 }) },
  { key: 'assert', label: 'Kiểm tra chữ có hiển thị', make: () => ({ type: 'assert', target: { text: '' }, visible: true }) },
  { key: 'tapIf', label: 'Nếu thấy chữ thì bấm (popup…)', make: () => ({ type: 'tapIf', target: { text: '' }, timeoutMs: 2000 }) },
  { key: 'text', label: 'Nhập chữ', make: () => ({ type: 'text', text: '' }) },
  { key: 'back', label: 'Phím Back', make: () => ({ type: 'key', code: Key.BACK, name: 'Back' }) },
  { key: 'home', label: 'Phím Home', make: () => ({ type: 'key', code: Key.HOME, name: 'Home' }) },
  { key: 'enter', label: 'Phím Enter', make: () => ({ type: 'key', code: Key.ENTER, name: 'Enter' }) },
  { key: 'recents', label: 'Phím Đa nhiệm', make: () => ({ type: 'key', code: Key.APP_SWITCH, name: 'Đa nhiệm' }) },
  { key: 'screenshot', label: 'Chụp màn hình', make: () => ({ type: 'screenshot' }) },
  { key: 'wifiOff', label: 'Môi trường: tắt Wi-Fi + 4G (test offline)', make: () => ({ type: 'network', wifi: 'off', data: 'off' }) },
  { key: 'wifiOn', label: 'Môi trường: bật lại Wi-Fi + 4G', make: () => ({ type: 'network', wifi: 'on', data: 'on' }) },
  {
    key: 'permission',
    label: 'Môi trường: cấp quyền cho app',
    make: (app) => ({ type: 'permission', pkg: app, permission: 'android.permission.CAMERA', grant: true })
  },
  { key: 'perfStartup', label: 'Hiệu năng: thời gian mở app ≤ … ms', make: () => ({ type: 'perf', metric: 'startup', max: 3000 }) },
  { key: 'perfMemory', label: 'Hiệu năng: RAM ≤ … MB', make: () => ({ type: 'perf', metric: 'memory', max: 300 }) },
  { key: 'perfCpu', label: 'Hiệu năng: CPU trung bình ≤ … %', make: () => ({ type: 'perf', metric: 'cpu', max: 80 }) },
  { key: 'perfJank', label: 'Hiệu năng: khung hình giật ≤ … %', make: () => ({ type: 'perf', metric: 'jank', max: 10 }) },
  { key: 'visual', label: 'So sánh màn hình với ảnh chuẩn', make: () => ({ type: 'visual', name: 'man-hinh-1', tolerance: 1, ignoreBars: true }) },
  {
    key: 'mockError',
    label: 'Giả lập: API / lệnh bị lỗi',
    make: () => ({ type: 'mock', rule: { match: '', kind: 'any', action: 'error', body: '' } })
  },
  {
    key: 'mockStatus',
    label: 'Giả lập: API trả về status (vd. 500)',
    make: () => ({ type: 'mock', rule: { match: '', kind: 'http', action: 'status', status: 500, body: '{"error":"server"}' } })
  },
  { key: 'mockDelay', label: 'Giả lập: API / lệnh chậm', make: () => ({ type: 'mock', rule: { match: '', kind: 'any', action: 'delay', delayMs: 5000 } }) },
  { key: 'mockClear', label: 'Bỏ mọi giả lập API', make: () => ({ type: 'mockClear' }) },
  { key: 'reloadWebView', label: 'Tải lại giao diện app (WebView)', make: () => ({ type: 'reloadWebView' }) },
  { key: 'api', label: 'Kiểm tra API / lệnh được gọi', make: () => ({ type: 'api', match: '', kind: 'any', status: 0, timeoutMs: 5000 }) },
  { key: 'apiAbsent', label: 'Kiểm tra KHÔNG gọi API', make: () => ({ type: 'api', match: '', kind: 'any', absent: true, timeoutMs: 3000 }) },
  {
    key: 'permCheck',
    label: 'Kiểm tra quyền đang cấp / từ chối',
    make: (app) => ({ type: 'permCheck', pkg: app, permission: 'android.permission.RECORD_AUDIO', expect: 'granted' })
  },
  { key: 'permRevokeAll', label: 'Thu hồi tất cả quyền (như mới cài)', make: (app) => ({ type: 'permRevokeAll', pkg: app }) },
  { key: 'appop', label: 'Đặt quyền đặc biệt (appops)', make: (app) => ({ type: 'appop', pkg: app, op: 'SYSTEM_ALERT_WINDOW', mode: 'allow' }) },
  { key: 'deeplink', label: 'Mở deep link / URL', make: () => ({ type: 'deeplink', url: '' }) },
  { key: 'otp', label: 'Chờ mã OTP (SMS / thông báo) rồi điền', make: () => ({ type: 'otp', timeoutMs: 60000 }) },
  { key: 'mockFile', label: 'Giả lập: phát lại API đã ghi (file)', make: () => ({ type: 'mockFile', path: '' }) },
  { key: 'shell', label: 'Lệnh adb shell', make: () => ({ type: 'shell', cmd: '' }) }
]

const PERMISSIONS = [
  'CAMERA',
  'RECORD_AUDIO',
  'ACCESS_FINE_LOCATION',
  'ACCESS_COARSE_LOCATION',
  'READ_CONTACTS',
  'READ_EXTERNAL_STORAGE',
  'WRITE_EXTERNAL_STORAGE',
  'POST_NOTIFICATIONS',
  'READ_PHONE_STATE',
  'CALL_PHONE',
  'READ_CALENDAR'
].map((p) => `android.permission.${p}`)

const mb = (b: number): string => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)

/** Shows how much disk the reports use and deletes old run folders on request. */
function ReportsCleaner() {
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null)
  const [days, setDays] = useState(30)
  const [msg, setMsg] = useState('')
  const refresh = (): void => void window.api.automation.reportStats().then(setStats)
  useEffect(refresh, [])
  if (!stats) return null
  const clean = async (): Promise<void> => {
    if (!confirm(`Xóa vĩnh viễn các báo cáo (kèm video, ảnh) cũ hơn ${days} ngày?`)) return
    const r = await window.api.automation.cleanReports(days)
    setMsg(r.deleted ? `Đã xóa ${r.deleted} báo cáo, giải phóng ${mb(r.freed)}` : 'Không có báo cáo nào cũ hơn mốc này')
    refresh()
  }
  return (
    <span className="reports-cleaner">
      · {stats.count} báo cáo, {mb(stats.bytes)} ·
      <a className="muted" onClick={clean}>xóa báo cáo cũ hơn</a>
      <select className="input sm" value={days} onChange={(e) => setDays(+e.target.value)}>
        {[1, 7, 14, 30, 90].map((d) => (
          <option key={d} value={d}>{d} ngày</option>
        ))}
      </select>
      {msg && <span className="ok">{msg}</span>}
    </span>
  )
}

const RESULT_VI: Record<string, string> = { passed: 'ĐẠT', failed: 'LỖI', crashed: 'CRASH', stopped: 'ĐÃ DỪNG' }

export function AutomationPanel({ serial }: { serial: string }) {
  const auto = useAutoState()
  const [script, setScriptState] = useState<Script>(() => loadJson('autoScript', emptyScript()))
  const [path, setPath] = useState<string | null>(() => localStorage.getItem('autoPath'))
  const [dirty, setDirty] = useState(false)
  const [opts, setOptsState] = useState<RunOptions>(() => loadJson('autoOpts', DEFAULT_RUN_OPTIONS))
  const [running, setRunning] = useState(false)
  const [states, setStates] = useState<Record<number, StepState>>({})
  const [iteration, setIteration] = useState<{ cur: number; total: number } | null>(null)
  const [webCount, setWebCount] = useState(0)
  const [log, setLog] = useState<LogLine[]>([])
  const [reports, setReports] = useState<{ path: string; title: string; bug?: string }[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [picked, setPicked] = useState<UiNode | null>(null)
  const [inspectBusy, setInspectBusy] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [tab, setTab] = useState<'script' | 'suite' | 'explore'>(() => {
    const t = localStorage.getItem('autoTab')
    return t === 'suite' || t === 'explore' ? t : 'script'
  })
  const [showInfo, setShowInfo] = useState(false)
  useEffect(() => localStorage.setItem('autoTab', tab), [tab])

  /** "Sửa" from the suite list: load that script file here. */
  const editFromSuite = async (p: string): Promise<void> => {
    if (dirty && script.steps.length && !confirm('Kịch bản đang mở có thay đổi chưa lưu. Bỏ qua và mở kịch bản khác?')) return
    try {
      const s = await window.api.automation.load(p)
      setScriptState({ ...emptyScript(), ...s })
      localStorage.setItem('autoScript', JSON.stringify(s))
      setPath(p)
      localStorage.setItem('autoPath', p)
      setDirty(false)
      setStates({})
      setTab('script')
    } catch (e) {
      pushLog('error', (e as Error).message)
    }
  }
  const listRef = useRef<HTMLDivElement>(null)

  const setScript = (fn: (s: Script) => Script): void => {
    setScriptState((s) => {
      const n = fn(s)
      localStorage.setItem('autoScript', JSON.stringify(n))
      return n
    })
    setDirty(true)
  }
  const setOpts = (o: RunOptions): void => {
    localStorage.setItem('autoOpts', JSON.stringify(o))
    setOptsState(o)
  }
  const pushLog = (level: LogLine['level'], message: string): void =>
    setLog((l) => [...l.slice(-199), { level, message, at: new Date().toLocaleTimeString('vi-VN') }])

  // Leaving the panel ends recording / inspecting.
  useEffect(() => () => autoStore.set({ recording: false, inspecting: false, highlight: null, maskEdit: null }), [])

  // Ignore-regions drawn on the screen for a visual step.
  useEffect(
    () =>
      onMasksDone((index, masks) => {
        if (!masks) return
        setScript((s) => ({
          ...s,
          steps: s.steps.map((st, k) => (k === index && st.type === 'visual' ? { ...st, masks: masks.length ? masks : undefined } : st))
        }))
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /* ------------------------------------------------------------ recording */

  const lastAction = useRef(0)
  const actionCount = useRef(0)
  const dumpCache = useRef<{ nodes: UiNode[]; token: number } | null>(null)
  const dumpTimer = useRef(0)
  /** A fresh screen dump is available: the next tap will be tied to an element. */
  const [targetsReady, setTargetsReady] = useState(false)

  useEffect(() => {
    if (!auto.recording) return
    // Keep a fresh UI dump between actions so taps can be tied to an element (id/text),
    // which makes replays robust to layout shifts. A dump takes ~2 s, so very quick
    // successive taps are recorded by position only.
    const scheduleDump = (): void => {
      clearTimeout(dumpTimer.current)
      const token = actionCount.current
      dumpTimer.current = window.setTimeout(async () => {
        try {
          const d = await window.api.automation.dumpUi(serial)
          if (token === actionCount.current) {
            dumpCache.current = { nodes: d.nodes, token }
            setTargetsReady(true)
          }
        } catch {
          /* secure screen or busy — positions only */
        }
      }, 600)
    }
    lastAction.current = performance.now()
    dumpCache.current = null
    setTargetsReady(false)
    // Warm-up: a WebView builds its accessibility tree only after the first dump, so read
    // the screen once (result ignored) before taking the dump used for the first tap.
    const startToken = actionCount.current
    void window.api.automation
      .dumpUi(serial)
      .catch(() => null)
      .then(() => {
        if (actionCount.current === startToken) scheduleDump()
      })
    const off = onRecord((raw) => {
      let step = raw
      const cache = dumpCache.current
      if ((step.type === 'tap' || step.type === 'longpress') && cache && cache.token === actionCount.current) {
        const n = nodeAt(cache.nodes, step.x, step.y)
        const sel = n ? selectorFor(n) : undefined
        if (sel) step = { ...step, target: sel }
      }
      const now = performance.now()
      const gap = now - lastAction.current
      lastAction.current = now
      actionCount.current++
      dumpCache.current = null
      setTargetsReady(false)
      setScript((s) => ({ ...s, steps: appendRecorded(s.steps, step, gap) }))
      scheduleDump()
    })
    return () => {
      off()
      clearTimeout(dumpTimer.current)
    }
  }, [auto.recording, serial])

  /* ------------------------------------------------------------ inspector */

  useEffect(
    () =>
      onInspect(async (x, y) => {
        setInspectBusy(true)
        try {
          const d = await window.api.automation.dumpUi(serial)
          const n = nodeAt(d.nodes, x, y)
          setPicked(n)
          autoStore.set({ highlight: n?.b ?? null })
          if (!n) pushLog('warn', 'Không có phần tử nào có chữ / id / mô tả tại điểm đó')
        } catch (e) {
          pushLog('error', `Không đọc được màn hình: ${(e as Error).message}`)
        } finally {
          setInspectBusy(false)
        }
      }),
    [serial]
  )

  /* ---------------------------------------------------------- run events */

  useEffect(
    () =>
      window.api.automation.onEvent((e: RunEvent) => {
        switch (e.kind) {
          case 'start':
            setIteration({ cur: 1, total: e.repeat })
            setWebCount(0)
            break
          case 'step':
            if (e.index === 0 && e.state === 'running') {
              setStates({})
              setIteration((it) => (it ? { ...it, cur: e.iteration + 1 } : it))
            }
            setStates((s) => ({ ...s, [e.index]: { state: e.state, message: e.message } }))
            if (e.state === 'running')
              listRef.current?.querySelector(`[data-i="${e.index}"]`)?.scrollIntoView({ block: 'nearest' })
            break
          case 'log':
            pushLog(e.level, e.message)
            break
          case 'webError':
            setWebCount((c) => c + 1)
            pushLog(e.error.kind === 'network' ? 'warn' : 'error', `[${e.error.kind === 'network' ? 'Mạng' : 'JS'}] ${e.error.message}${e.error.step ? ` (bước ${e.error.step})` : ''}`)
            break
          case 'report':
            setReports((r) => [{ path: e.path, title: e.title, bug: e.bug }, ...r].slice(0, 20))
            break
          case 'end':
            pushLog(e.result === 'passed' ? 'ok' : e.result === 'stopped' ? 'warn' : 'error', `${RESULT_VI[e.result] ?? e.result}: ${e.message}`)
            break
        }
      }),
    []
  )

  /* ------------------------------------------------------------- actions */

  const insert = (step: Step): void => {
    setScript((s) => {
      const steps = [...s.steps]
      const at = selected !== null && selected < steps.length ? selected + 1 : steps.length
      steps.splice(at, 0, step)
      setSelected(at)
      return { ...s, steps }
    })
  }
  const updateStep = (i: number, patch: Partial<Step>): void =>
    setScript((s) => ({ ...s, steps: s.steps.map((st, k) => (k === i ? ({ ...st, ...patch } as Step) : st)) }))
  const updateTarget = (i: number, patch: Partial<Selector>): void =>
    setScript((s) => ({
      ...s,
      steps: s.steps.map((st, k) => (k === i && 'target' in st && st.target ? ({ ...st, target: { ...st.target, ...patch } } as Step) : st))
    }))
  const move = (i: number, d: -1 | 1): void =>
    setScript((s) => {
      const j = i + d
      if (j < 0 || j >= s.steps.length) return s
      const steps = [...s.steps]
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      setSelected(j)
      return { ...s, steps }
    })
  const duplicate = (i: number): void =>
    setScript((s) => {
      const steps = [...s.steps]
      steps.splice(i + 1, 0, structuredClone(steps[i]))
      setSelected(i + 1)
      return { ...s, steps }
    })
  const remove = (i: number): void => {
    setScript((s) => ({ ...s, steps: s.steps.filter((_, k) => k !== i) }))
    setSelected(null)
  }

  const run = async (): Promise<void> => {
    if (!script.steps.length) return
    const risky = destructiveSteps(script)
    const freshWarn = script.app ? freshRisk(opts.fresh, opts.freshPerms) : null
    if (freshWarn) risky.unshift(`Trước khi chạy: ${freshWarn} (${script.app})`)
    if (risky.length && !confirm(`Kịch bản có ${risky.length} bước sẽ THAY ĐỔI dữ liệu / thiết lập trên điện thoại:\n\n${risky.join('\n')}\n\nVẫn chạy?`)) return
    autoStore.set({ recording: false, inspecting: false, highlight: null, running: true, unlocked: false })
    setRunning(true)
    setStates({})
    setLog([])
    try {
      await window.api.automation.run(serial, script, opts)
    } catch (e) {
      pushLog('error', (e as Error).message)
    } finally {
      setRunning(false)
      autoStore.set({ running: false, unlocked: false })
    }
  }

  const save = async (as: boolean): Promise<void> => {
    const p = await window.api.automation.save(script, as ? null : path)
    if (p) {
      setPath(p)
      localStorage.setItem('autoPath', p)
      setDirty(false)
      pushLog('ok', `Đã lưu ${p}`)
    }
  }
  const open = async (): Promise<void> => {
    try {
      const r = await window.api.automation.open()
      if (!r) return
      setScript(() => ({ ...emptyScript(), ...r.script }))
      setPath(r.path)
      localStorage.setItem('autoPath', r.path)
      setDirty(false)
      setStates({})
    } catch (e) {
      pushLog('error', (e as Error).message)
    }
  }
  const newScript = (): void => {
    if (script.steps.length && dirty && !confirm('Bỏ kịch bản hiện tại (chưa lưu)?')) return
    setScript(() => ({ ...emptyScript(), app: script.app }))
    setPath(null)
    localStorage.removeItem('autoPath')
    setDirty(false)
    setStates({})
    setSelected(null)
  }

  const addFromPicked = (kind: 'tap' | 'tapIf' | 'waitFor' | 'assert' | 'gone'): void => {
    if (!picked) return
    const target = selectorFor(picked)
    const x = Math.round(((picked.b[0] + picked.b[2]) / 2) * 1000) / 1000
    const y = Math.round(((picked.b[1] + picked.b[3]) / 2) * 1000) / 1000
    if (kind === 'tap') insert({ type: 'tap', x, y, target })
    else if (!target) pushLog('warn', 'Phần tử này không có chữ / id / mô tả để tìm')
    else if (kind === 'tapIf') insert({ type: 'tapIf', target, timeoutMs: 2000 })
    else if (kind === 'waitFor') insert({ type: 'waitFor', target, timeoutMs: 10_000 })
    else insert({ type: 'assert', target, visible: kind === 'assert' })
  }

  const toggleRecord = (): void => autoStore.set({ recording: !auto.recording, inspecting: false, highlight: null })
  const toggleInspect = (): void => {
    autoStore.set({ inspecting: !auto.inspecting, recording: false, highlight: null })
    setPicked(null)
  }

  /* ------------------------------------------------------------------ ui */

  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

  /** Editor for a step's element selector: text (or description) + match mode. */
  const targetFields = (i: number, t: Selector): React.ReactNode => {
    const editsDesc = !t.text && !!t.desc
    return (
      <>
        <input
          className="input sm grow"
          value={(editsDesc ? t.desc : t.text) ?? ''}
          placeholder={editsDesc ? 'mô tả (content-desc)' : 'chữ trên màn hình'}
          onClick={stop}
          onChange={(e) => updateTarget(i, editsDesc ? { desc: e.target.value || undefined } : { text: e.target.value || undefined })}
        />
        <select
          className="input sm"
          value={t.match ?? 'exact'}
          title="Cách so khớp chữ"
          onClick={stop}
          onChange={(e) => updateTarget(i, { match: e.target.value as MatchMode })}
        >
          <option value="exact">đúng y</option>
          <option value="contains">chứa</option>
          <option value="prefix">bắt đầu bằng</option>
        </select>
        {t.id && (
          <span className="chip" title={t.id}>
            #{t.id.split(':id/').pop()}
            <button className="chip-x" title="Bỏ id (chỉ tìm theo chữ)" onClick={(e) => { e.stopPropagation(); updateTarget(i, { id: undefined }) }}>×</button>
          </span>
        )}
      </>
    )
  }

  const field = (i: number, s: Step): React.ReactNode => {
    switch (s.type) {
      case 'wait':
        return <input className="input sm" type="number" min={0} step={100} value={s.ms} onClick={stop} onChange={(e) => updateStep(i, { ms: +e.target.value })} />
      case 'text':
        return <input className="input sm grow" value={s.text} placeholder="chữ cần nhập" onClick={stop} onChange={(e) => updateStep(i, { text: e.target.value })} />
      case 'tap':
      case 'longpress':
        return s.target ? targetFields(i, s.target) : null
      case 'tapIf':
      case 'waitFor':
        return (
          <>
            {targetFields(i, s.target)}
            <input
              className="input sm num"
              type="number"
              min={0}
              step={s.type === 'tapIf' ? 0.5 : 1}
              value={s.timeoutMs / 1000}
              title="Chờ tối đa (giây)"
              onClick={stop}
              onChange={(e) => updateStep(i, { timeoutMs: Math.round(+e.target.value * 1000) })}
            />
            <span className="muted">giây</span>
          </>
        )
      case 'assert':
        return (
          <>
            {targetFields(i, s.target)}
            <select className="input sm" value={s.visible ? '1' : '0'} onClick={stop} onChange={(e) => updateStep(i, { visible: e.target.value === '1' })}>
              <option value="1">có hiển thị</option>
              <option value="0">không hiển thị</option>
            </select>
          </>
        )
      case 'launch':
        return (
          <>
            <PackagePicker serial={serial} className="sm grow" value={s.pkg} placeholder="package" onChange={(p) => updateStep(i, { pkg: p })} />
            <label className="check" onClick={stop} title="pm clear — XÓA toàn bộ dữ liệu của app">
              <input type="checkbox" checked={s.clear} onChange={(e) => updateStep(i, { clear: e.target.checked })} /> xóa dữ liệu
            </label>
          </>
        )
      case 'stopApp':
        return <PackagePicker serial={serial} className="sm grow" value={s.pkg} placeholder="package" onChange={(p) => updateStep(i, { pkg: p })} />
      case 'network': {
        const sel = (k: 'wifi' | 'data', label: string): React.ReactNode => (
          <label className="field-inline" onClick={stop}>
            {label}
            <select className="input sm" value={s[k] ?? ''} onChange={(e) => updateStep(i, { [k]: e.target.value || undefined } as Partial<Step>)}>
              <option value="">giữ nguyên</option>
              <option value="on">bật</option>
              <option value="off">tắt</option>
            </select>
          </label>
        )
        return (
          <>
            {sel('wifi', 'Wi-Fi')}
            {sel('data', '4G/5G')}
          </>
        )
      }
      case 'permission':
        return (
          <>
            <select className="input sm" value={s.grant ? '1' : '0'} onClick={stop} onChange={(e) => updateStep(i, { grant: e.target.value === '1' })}>
              <option value="1">cấp</option>
              <option value="0">thu hồi</option>
            </select>
            <select className="input sm" value={s.permission} onClick={stop} onChange={(e) => updateStep(i, { permission: e.target.value })}>
              {(PERMISSIONS.includes(s.permission) ? PERMISSIONS : [s.permission, ...PERMISSIONS]).map((p) => (
                <option key={p} value={p}>{p.replace('android.permission.', '')}</option>
              ))}
            </select>
            <PackagePicker serial={serial} className="sm grow" value={s.pkg} placeholder="package" onChange={(p) => updateStep(i, { pkg: p })} />
          </>
        )
      case 'mockFile':
        return (
          <>
            <span className="muted mono" title={s.path}>{s.path ? s.path.split(/[\\/]/).pop() : 'chưa chọn file'}</span>
            <button
              className="iconbtn"
              onClick={async (e) => {
                stop(e)
                const p = await window.api.net.openMockSet()
                if (p) updateStep(i, { path: p.path })
              }}
            >
              Chọn file…
            </button>
          </>
        )
      case 'otp':
        return (
          <>
            <span className="muted">Chờ tối đa</span>
            <input
              className="input sm num"
              type="number"
              min={5}
              value={s.timeoutMs / 1000}
              onClick={stop}
              onChange={(e) => updateStep(i, { timeoutMs: Math.round(Math.max(5, +e.target.value) * 1000) })}
            />
            <span className="muted">giây — chạm vào ô nhập mã trước bước này</span>
          </>
        )
      case 'deeplink':
        return <input className="input sm grow" value={s.url} placeholder="myapp://screen/123 hoặc https://…" onClick={stop} onChange={(e) => updateStep(i, { url: e.target.value })} />
      case 'api':
        return (
          <>
            <select className="input sm" value={s.kind ?? 'any'} onClick={stop} onChange={(e) => updateStep(i, { kind: e.target.value as 'any' })} title="Loại lời gọi">
              <option value="any">HTTP hoặc lệnh</option>
              <option value="http">HTTP</option>
              <option value="ipc">lệnh Tauri</option>
            </select>
            <input
              className="input sm grow mono"
              value={s.match}
              placeholder='URL / lệnh chứa… VD: /api/login, plugin:sql|select'
              onClick={stop}
              onChange={(e) => updateStep(i, { match: e.target.value })}
            />
            {!s.absent && (
              <>
                <select className="input sm" value={s.method ?? ''} onClick={stop} onChange={(e) => updateStep(i, { method: e.target.value || undefined })}>
                  <option value="">mọi method</option>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'invoke'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <input
                  className="input sm num"
                  type="number"
                  min={0}
                  value={s.status ?? 0}
                  title="Status mong muốn (0 = mọi kết quả thành công)"
                  onClick={stop}
                  onChange={(e) => updateStep(i, { status: +e.target.value || 0 })}
                />
                <input
                  className="input sm"
                  style={{ width: 130 }}
                  value={s.bodyContains ?? ''}
                  placeholder="kết quả chứa…"
                  onClick={stop}
                  onChange={(e) => updateStep(i, { bodyContains: e.target.value || undefined })}
                />
              </>
            )}
            <input
              className="input sm num"
              type="number"
              min={0.5}
              step={0.5}
              value={s.timeoutMs / 1000}
              title="Chờ tối đa (giây)"
              onClick={stop}
              onChange={(e) => updateStep(i, { timeoutMs: Math.round(+e.target.value * 1000) })}
            />
            <span className="muted">giây</span>
          </>
        )
      case 'perf':
        return (
          <>
            <select className="input sm" value={s.metric} onClick={stop} onChange={(e) => updateStep(i, { metric: e.target.value as 'startup' })}>
              {(Object.keys(PERF_LABEL) as (keyof typeof PERF_LABEL)[]).map((k) => (
                <option key={k} value={k}>{PERF_LABEL[k]}</option>
              ))}
            </select>
            <label className="field-inline" onClick={stop}>
              ≤ <input className="input sm num" type="number" min={0} value={s.max} onChange={(e) => updateStep(i, { max: +e.target.value })} /> {PERF_UNIT[s.metric]}
            </label>
          </>
        )
      case 'visual':
        return (
          <>
            <input className="input sm grow" value={s.name} placeholder="tên ảnh chuẩn" onClick={stop} onChange={(e) => updateStep(i, { name: e.target.value })} />
            <label className="field-inline" onClick={stop} title="Tỉ lệ điểm ảnh được phép khác (%)">
              lệch ≤
              <input className="input sm num" type="number" min={0} max={100} step={0.5} value={s.tolerance} onChange={(e) => updateStep(i, { tolerance: +e.target.value })} />%
            </label>
            <label className="check" onClick={stop} title="Bỏ qua thanh trạng thái (giờ, pin) và thanh điều hướng">
              <input type="checkbox" checked={s.ignoreBars} onChange={(e) => updateStep(i, { ignoreBars: e.target.checked })} /> bỏ qua thanh trạng thái
            </label>
            <button
              className={`iconbtn ${auto.maskEdit?.index === i ? 'on' : ''}`}
              title="Khoanh trên màn hình điện thoại các vùng hay thay đổi (ngày giờ, lời chào…) để không so sánh"
              onClick={(e) => {
                e.stopPropagation()
                autoStore.set({ maskEdit: { index: i, masks: s.masks ?? [] }, recording: false, inspecting: false, highlight: null })
              }}
            >
              Vùng bỏ qua ({s.masks?.length ?? 0})
            </button>
          </>
        )
      case 'mock': {
        const r = s.rule
        const setRule = (patch: Partial<MockRule>): void => updateStep(i, { rule: { ...r, ...patch } })
        return (
          <>
            <select className="input sm" value={r.kind} onClick={stop} onChange={(e) => setRule({ kind: e.target.value as MockRule['kind'] })}>
              <option value="any">HTTP hoặc lệnh</option>
              <option value="http">HTTP</option>
              <option value="ipc">lệnh Tauri</option>
            </select>
            <input className="input sm grow mono" value={r.match} placeholder="URL / lệnh chứa…" onClick={stop} onChange={(e) => setRule({ match: e.target.value })} />
            <select className="input sm" value={r.action} onClick={stop} onChange={(e) => setRule({ action: e.target.value as MockRule['action'] })}>
              <option value="error">lỗi / mất mạng</option>
              <option value="status">trả về status</option>
              <option value="delay">chậm</option>
            </select>
            {r.action === 'status' && (
              <input className="input sm num" type="number" min={100} max={599} value={r.status ?? 500} title="HTTP status" onClick={stop} onChange={(e) => setRule({ status: +e.target.value })} />
            )}
            {r.action === 'delay' ? (
              <label className="field-inline" onClick={stop}>
                <input className="input sm num" type="number" min={0} step={0.5} value={(r.delayMs ?? 0) / 1000} onChange={(e) => setRule({ delayMs: Math.round(+e.target.value * 1000) })} /> giây
              </label>
            ) : (
              <input
                className="input sm mono"
                style={{ width: 150 }}
                value={r.body ?? ''}
                placeholder={r.action === 'error' ? 'thông báo lỗi' : 'nội dung trả về'}
                onClick={stop}
                onChange={(e) => setRule({ body: e.target.value })}
              />
            )}
          </>
        )
      }
      case 'permCheck':
        return (
          <>
            <select className="input sm" value={s.permission} onClick={stop} onChange={(e) => updateStep(i, { permission: e.target.value })}>
              {(PERMISSIONS.includes(s.permission) ? PERMISSIONS : [s.permission, ...PERMISSIONS]).map((p) => (
                <option key={p} value={p}>{p.replace('android.permission.', '')}</option>
              ))}
            </select>
            <select className="input sm" value={s.expect} onClick={stop} onChange={(e) => updateStep(i, { expect: e.target.value as 'granted' })}>
              <option value="granted">đang được cấp</option>
              <option value="denied">bị từ chối</option>
            </select>
            <PackagePicker serial={serial} className="sm grow" value={s.pkg} placeholder="package" onChange={(p) => updateStep(i, { pkg: p })} />
          </>
        )
      case 'permRevokeAll':
        return <PackagePicker serial={serial} className="sm grow" value={s.pkg} placeholder="package" onChange={(p) => updateStep(i, { pkg: p })} />
      case 'appop':
        return (
          <>
            <select className="input sm" value={s.op} onClick={stop} onChange={(e) => updateStep(i, { op: e.target.value })}>
              {['SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES', 'SCHEDULE_EXACT_ALARM', 'WRITE_SETTINGS', 'GET_USAGE_STATS', 'MANAGE_EXTERNAL_STORAGE', 'RUN_ANY_IN_BACKGROUND']
                .concat(['SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES', 'SCHEDULE_EXACT_ALARM', 'WRITE_SETTINGS', 'GET_USAGE_STATS', 'MANAGE_EXTERNAL_STORAGE', 'RUN_ANY_IN_BACKGROUND'].includes(s.op) ? [] : [s.op])
                .map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
            </select>
            <select className="input sm" value={s.mode} onClick={stop} onChange={(e) => updateStep(i, { mode: e.target.value as 'allow' })}>
              <option value="allow">cho phép</option>
              <option value="ignore">chặn (ignore)</option>
              <option value="deny">từ chối</option>
              <option value="default">mặc định</option>
            </select>
            <PackagePicker serial={serial} className="sm grow" value={s.pkg} placeholder="package" onChange={(p) => updateStep(i, { pkg: p })} />
          </>
        )
      case 'shell':
        return (
          <>
            <input className="input sm grow mono" value={s.cmd} placeholder="VD: settings get system screen_off_timeout" onClick={stop} onChange={(e) => updateStep(i, { cmd: e.target.value })} />
            <input
              className="input sm"
              style={{ width: 140 }}
              value={s.expect ?? ''}
              placeholder="kết quả phải chứa…"
              onClick={stop}
              onChange={(e) => updateStep(i, { expect: e.target.value || undefined })}
            />
          </>
        )
      case 'screenshot':
        return <input className="input sm grow" value={s.label ?? ''} placeholder="nhãn (không bắt buộc)" onClick={stop} onChange={(e) => updateStep(i, { label: e.target.value })} />
      default:
        return null
    }
  }

  const stateIcon = (st?: StepState): React.ReactNode => {
    if (!st) return <Circle size={12} className="muted-ic" />
    if (st.state === 'running') return <Loader2 size={12} className="spin" />
    if (st.state === 'ok') return <CircleCheck size={12} className="ok" />
    if (st.state === 'warn') return <TriangleAlert size={12} style={{ color: 'var(--warn)' }} />
    return <CircleX size={12} className="bad" />
  }

  const editable = !running && !auto.recording
  const check = (k: keyof RunOptions, label: string, title?: string): React.ReactNode => (
    <label className="check" title={title}>
      <input type="checkbox" checked={!!opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {label}
    </label>
  )

  return (
    <div className="panel wide auto">
      <div className="panel-head">
        <div className="seg">
          <button className={tab === 'script' ? 'on' : ''} onClick={() => setTab('script')}>Kịch bản</button>
          <button className={tab === 'suite' ? 'on' : ''} onClick={() => setTab('suite')}>Bộ test</button>
          <button className={tab === 'explore' ? 'on' : ''} onClick={() => setTab('explore')}>Tự khám phá</button>
        </div>
        {tab === 'script' && (
          <>
            <input
              className="input"
              style={{ flex: 1, minWidth: 80 }}
              value={script.name}
              onChange={(e) => setScript((s) => ({ ...s, name: e.target.value }))}
              title={path ?? 'chưa lưu'}
            />
            {dirty && <span className="muted-ic" title="có thay đổi chưa lưu">●</span>}
            <button className="iconbtn" title="Kịch bản mới" disabled={running} onClick={newScript}><FilePlus2 size={13} /></button>
            <button className="iconbtn" title="Mở kịch bản (.json)" disabled={running} onClick={open}><FolderOpen size={13} /></button>
            <button className="iconbtn" title="Lưu (Shift+click: lưu thành file khác)" onClick={(e) => void save(e.shiftKey || !path)}><Save size={13} /></button>
          </>
        )}
      </div>

      {tab === 'explore' ? (
        <ExplorePanel serial={serial} />
      ) : tab === 'suite' ? (
        <SuitePanel serial={serial} opts={opts} currentScriptPath={dirty ? null : path} onEditScript={editFromSuite} />
      ) : (
      <>
      <div className="auto-row">
        <PackagePicker
          serial={serial}
          placeholder="App cần test (package) — crash và lỗi JS của app này sẽ được ghi lại"
          value={script.app}
          onChange={(p) => setScript((s) => ({ ...s, app: p }))}
          style={{ flex: 1 }}
        />
        <button className={`iconbtn ${showInfo ? 'on' : ''}`} onClick={() => setShowInfo(!showInfo)} title="Mục đích / Kết quả mong muốn — dùng khi xuất file KBKT">
          KBKT
        </button>
      </div>
      {showInfo && (
        <div className="auto-row kbkt-info">
          <label className="sfield">
            <span>Mục đích kiểm thử</span>
            <input className="input sm" value={script.purpose ?? ''} placeholder={script.name} onChange={(e) => setScript((s) => ({ ...s, purpose: e.target.value }))} />
          </label>
          <label className="sfield">
            <span>Kết quả mong muốn (để trống = tự sinh từ các bước kiểm tra)</span>
            <textarea className="input sm" rows={2} value={script.expected ?? ''} placeholder={expectedOf(script)} onChange={(e) => setScript((s) => ({ ...s, expected: e.target.value }))} />
          </label>
        </div>
      )}

      <div className="auto-row">
        {running ? (
          <button className="iconbtn danger-solid" onClick={() => void window.api.automation.stop()}>
            <Square size={12} /> Dừng
          </button>
        ) : (
          <button className="iconbtn primary" disabled={!script.steps.length || auto.recording} onClick={run}>
            <Play size={12} /> Chạy
          </button>
        )}
        <button className={`iconbtn ${auto.recording ? 'rec-on' : ''}`} disabled={running} onClick={toggleRecord} title="Ghi lại các thao tác chạm, vuốt, gõ phím… trên màn hình điện thoại">
          <span className="rec-dot" /> {auto.recording ? 'Dừng ghi' : 'Ghi thao tác'}
        </button>
        <button className={`iconbtn ${auto.inspecting ? 'on' : ''}`} disabled={running} onClick={toggleInspect} title="Bấm vào một phần tử trên màn hình để xem và tạo bước kiểm tra">
          <Crosshair size={13} /> Soi phần tử
        </button>
        <span className="spacer" />
        <label className="field-inline" title="Chạy cả kịch bản bao nhiêu lượt">
          Lượt
          <input className="input sm num" type="number" min={1} max={9999} value={opts.repeat} onChange={(e) => setOpts({ ...opts, repeat: Math.max(1, +e.target.value || 1) })} />
        </label>
        <select className="input sm" value={opts.speed} onChange={(e) => setOpts({ ...opts, speed: +e.target.value })} title="Tốc độ các bước chờ đã ghi">
          <option value={2}>chậm ×0.5</option>
          <option value={1}>bình thường</option>
          <option value={0.5}>nhanh ×2</option>
          <option value={0.25}>rất nhanh ×4</option>
        </select>
      </div>
      <div className="auto-row opts">
        {check('smartTargets', 'Tìm lại phần tử khi bấm', 'Trước khi bấm, tìm lại phần tử theo chữ/id (chạy đúng dù giao diện xê dịch)')}
        {check('stopOnCrash', 'Dừng khi crash/ANR')}
        {check('stopOnFailure', 'Dừng khi kiểm tra lỗi')}
        {check('recordVideo', 'Quay video', 'Quay màn hình suốt lần chạy và đính kèm vào báo cáo')}
        {check('webErrors', 'Bắt lỗi WebView', 'Kết nối DevTools của WebView (app build debug) để bắt lỗi JS, console.error, request lỗi')}
        {check('captureApi', 'Ghi API', 'Ghi lại mọi request HTTP và lệnh Tauri (JS → Rust) vào báo cáo; cần cho bước "Kiểm tra API"')}
        {check('measurePerf', 'Đo hiệu năng', 'Đo thời gian mở app, RAM / CPU (mỗi 2 giây) và tỉ lệ khung hình giật; hiện biểu đồ trong báo cáo')}
        {check('updateBaselines', 'Cập nhật ảnh chuẩn', 'Bước "So sánh màn hình" sẽ LƯU màn hình hiện tại làm ảnh chuẩn mới thay vì so sánh (dùng khi giao diện thay đổi có chủ đích)')}
        {opts.webErrors && check('failOnWebErrors', 'Lỗi JS = test lỗi', 'Đánh dấu lần chạy là LỖI nếu có lỗi JavaScript')}
      </div>
      <div className="auto-row opts">
        <FreshOptions
          fresh={opts.fresh ?? 'off'}
          perms={opts.freshPerms ?? 'keep'}
          app={script.app}
          disabled={running}
          onChange={(fresh, freshPerms) => setOpts({ ...opts, fresh, freshPerms })}
        />
        <span className="spacer" />
        <select
          className="input sm"
          value=""
          disabled={!editable}
          onChange={(e) => {
            const a = ADDABLE.find((x) => x.key === e.target.value)
            if (a) insert(a.make(script.app))
          }}
        >
          <option value="">+ Thêm bước…</option>
          {ADDABLE.map((a) => (
            <option key={a.key} value={a.key}>{a.label}</option>
          ))}
        </select>
      </div>

      {auto.recording && (
        <div className="auto-meta">
          {targetsReady ? (
            <span className="ok">✓ Sẵn sàng — lần chạm tiếp theo sẽ được gắn với phần tử trên màn hình</span>
          ) : (
            <span className="muted">
              <Loader2 size={11} className="spin" /> Đang đọc màn hình… (chạm lúc này sẽ chỉ ghi theo tọa độ)
            </span>
          )}
        </div>
      )}
      {iteration && (
        <div className="auto-meta">
          {running ? 'Đang chạy' : 'Lần chạy trước'} — lượt {iteration.cur}/{iteration.total}
          {webCount > 0 && <span className="bad"> · {webCount} lỗi WebView</span>}
        </div>
      )}

      <div className="steps" ref={listRef}>
        {script.steps.length === 0 && (
          <div className="steps-empty">
            Bấm <b>Ghi thao tác</b> rồi dùng điện thoại bên trái — chạm, vuốt, cuộn, gõ chữ, nút Back/Home sẽ thành các bước.
            <br />
            Dùng <b>Soi phần tử</b> để thêm bước “chờ xuất hiện”, “kiểm tra hiển thị”, “nếu thấy thì bấm”, rồi bấm <b>Chạy</b>.
          </div>
        )}
        {script.steps.map((s, i) => {
          const st = states[i]
          const f = editable ? field(i, s) : null
          return (
            <div
              key={i}
              data-i={i}
              className={`step ${selected === i ? 'sel' : ''} ${st ? `st-${st.state}` : ''}`}
              onClick={() => setSelected(selected === i ? null : i)}
            >
              <span className="n">{i + 1}</span>
              <span className="si">{stateIcon(st)}</span>
              <div className="body">
                <div className="d">{describeStep(s)}</div>
                {f && <div className="f">{f}</div>}
                {st?.message && <div className={`m ${st.state}`}>{st.message}</div>}
              </div>
              {editable && (
                <span className="acts">
                  <button className="iconbtn ghost" title="Lên" onClick={(e) => { e.stopPropagation(); move(i, -1) }}><ArrowUp size={12} /></button>
                  <button className="iconbtn ghost" title="Xuống" onClick={(e) => { e.stopPropagation(); move(i, 1) }}><ArrowDown size={12} /></button>
                  <button className="iconbtn ghost" title="Nhân bản" onClick={(e) => { e.stopPropagation(); duplicate(i) }}><Copy size={12} /></button>
                  <button className="iconbtn ghost danger" title="Xóa" onClick={(e) => { e.stopPropagation(); remove(i) }}><Trash2 size={12} /></button>
                </span>
              )}
            </div>
          )
        })}
      </div>

      {auto.inspecting && (
        <div className="inspect">
          {inspectBusy ? (
            <span className="muted"><Loader2 size={12} className="spin" /> Đang đọc màn hình…</span>
          ) : picked ? (
            <>
              <div className="kv">
                <span><b>loại</b> {picked.cls}</span>
                {picked.id && <span><b>id</b> {picked.id.split(':id/').pop()}</span>}
                {picked.text && <span><b>chữ</b> “{picked.text}”</span>}
                {picked.desc && <span><b>mô tả</b> “{picked.desc}”</span>}
                <span><b>tìm bằng</b> {selectorFor(picked) ? selectorLabel(selectorFor(picked)!) : '—'}</span>
              </div>
              <div className="auto-row" style={{ padding: 0, border: 0 }}>
                <button className="iconbtn" onClick={() => addFromPicked('tap')}>+ Bấm</button>
                <button className="iconbtn" onClick={() => addFromPicked('tapIf')}>+ Nếu thấy thì bấm</button>
                <button className="iconbtn" onClick={() => addFromPicked('waitFor')}>+ Chờ xuất hiện</button>
                <button className="iconbtn" onClick={() => addFromPicked('assert')}>+ Kiểm tra có hiển thị</button>
                <button className="iconbtn" onClick={() => addFromPicked('gone')}>+ Kiểm tra không hiển thị</button>
              </div>
            </>
          ) : (
            <span className="muted">Bấm vào một phần tử trên màn hình điện thoại để xem thông tin.</span>
          )}
        </div>
      )}

      <PaneHandle id="auto-log" />
      <div className="auto-log">
        {log.map((l, i) => (
          <div key={i} className={`ll ${l.level}`}>
            <span className="t">{l.at}</span> {l.message}
          </div>
        ))}
        {reports.map((r) => (
          <div key={r.path} className="ll report">
            <FileText size={12} /> <a onClick={() => void window.api.openPath(r.path)}>Báo cáo: {r.title}</a>
            <a className="muted" onClick={() => void window.api.reveal(r.path)}>thư mục</a>
            {r.bug && (
              <button
                className="iconbtn bug-btn"
                title="Chép tiêu đề, môi trường, bước tái hiện, kết quả mong muốn/thực tế và đường dẫn đính kèm — dán thẳng vào Jira / Redmine"
                onClick={() => {
                  void navigator.clipboard.writeText(r.bug!)
                  setCopied(r.path)
                }}
              >
                {copied === r.path ? 'Đã chép ✓' : 'Chép nội dung báo lỗi'}
              </button>
            )}
          </div>
        ))}
        <div className="ll">
          <a className="muted" onClick={() => void window.api.automation.openBaselinesDir()}>Ảnh chuẩn…</a>
          <a className="muted" onClick={() => void window.api.automation.openReportsDir()}>Mở tất cả báo cáo…</a>
          <a
            className="muted"
            title="Chọn 2 thư mục báo cáo của cùng kịch bản (bản cũ, bản mới) — xem bước nào mới lỗi, API / hiệu năng / ảnh thay đổi"
            onClick={() => void window.api.automation.compareRuns().catch((e: Error) => alert(e.message))}
          >
            So sánh 2 lần chạy…
          </a>
          <a
            className="muted"
            title="Tỉ lệ đạt theo thời gian của từng kịch bản và danh sách test chập chờn (lúc đạt lúc lỗi), 30 ngày gần nhất"
            onClick={() => void window.api.automation.trends().catch((e: Error) => alert(e.message))}
          >
            Xu hướng kết quả…
          </a>
          <ReportsCleaner />
        </div>
      </div>
      </>
      )}
    </div>
  )
}
