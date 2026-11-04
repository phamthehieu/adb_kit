import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Circle,
  CircleCheck,
  CircleX,
  FileSpreadsheet,
  FilePlus2,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  Play,
  Plus,
  Save,
  Smartphone,
  Square,
  Table,
  Trash2,
  X
} from 'lucide-react'
import { autoStore } from '../lib/automation'
import { MultiRunBox } from './MultiRunBox'
import { FreshOptions } from './FreshOptions'
import { destructiveSteps, emptySuite, freshRisk, kbktKey, suiteFresh, type KbktImport, type KbktLink, type CaseInfo, type CaseState, type RunOptions, type ScriptInfo, type Suite, type SuiteEvent } from '@shared/automation'

interface Props {
  serial: string
  opts: RunOptions
  /** Path of the script open in the "Kịch bản" tab (to add it quickly). */
  currentScriptPath: string | null
  /** Open a script of the suite in the "Kịch bản" tab. */
  onEditScript: (path: string) => void
}

type DataInfo = { rows: number; columns: string[] }

const STATE_LABEL: Record<CaseState, string> = {
  pending: 'chờ',
  running: 'đang chạy',
  passed: 'ĐẠT',
  failed: 'LỖI',
  crashed: 'CRASH',
  stopped: 'đã dừng'
}

function loadSuite(): Suite {
  try {
    const v = localStorage.getItem('autoSuite')
    return v ? { ...emptySuite(), ...JSON.parse(v) } : emptySuite()
  } catch {
    return emptySuite()
  }
}

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p

type CaseView = { state: CaseState; attempt: number; message?: string; report?: string }

/**
 * Test cases imported from an existing KBKT file. Each row is either verified by a script
 * (run with the suite) or marked by hand (P / F / PE); results go into a copy of the file.
 */
function KbktSection(props: {
  kbkt?: KbktImport
  running: boolean
  caseOf: (key: string) => CaseView | undefined
  onChange: (k: KbktImport | undefined) => void
  onWriteManual: () => void
}) {
  const { kbkt, running, caseOf, onChange } = props
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState('')

  const importFile = async (): Promise<void> => {
    setErr('')
    try {
      const r = await window.api.suite.importKbkt()
      if (!r) return
      // Keep links / manual results of rows that still exist when re-importing the same file.
      const prev = new Map((kbkt?.rows ?? []).map((x) => [kbktKey(x), x]))
      onChange({
        ...r,
        rows: r.rows.map((x) => {
          const p = prev.get(kbktKey(x))
          return p ? { ...x, script: p.script, manual: p.manual, note: p.note } : x
        })
      })
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  if (!kbkt)
    return (
      <div className="kbkt-empty">
        <button className="iconbtn" disabled={running} onClick={importFile}>
          <FileSpreadsheet size={12} /> Nhập testcase từ file KBKT…
        </button>
        <span className="muted">Dùng file KBKT tester đã viết (mẫu BES hoặc BCCS): gắn kịch bản tự động cho từng dòng, hoặc đánh kết quả test tay — kết quả được ghi vào một bản sao của file.</span>
        {err && <span className="bad">{err}</span>}
      </div>
    )

  const update = (key: string, patch: Partial<KbktLink>): void =>
    onChange({ ...kbkt, rows: kbkt.rows.map((r) => (kbktKey(r) === key ? { ...r, ...patch } : r)) })
  const q = filter.trim().toLowerCase()
  const rows = kbkt.rows.filter((r) => !q || `${r.code} ${r.group} ${r.purpose} ${r.sheet}`.toLowerCase().includes(q))
  const linked = kbkt.rows.filter((r) => r.script).length
  const manual = kbkt.rows.filter((r) => r.manual).length
  let lastHead = ''

  return (
    <div className="kbkt-box">
      <div className="kbkt-head">
        <FileSpreadsheet size={14} />
        <b title={kbkt.file}>{fileName(kbkt.file)}</b>
        <span className="muted">
          mẫu {kbkt.layout} · {kbkt.rows.length} testcase · {linked} tự động · {manual} test tay
        </span>
        <span className="spacer" />
        <input className="input sm" style={{ width: 160 }} placeholder="Lọc testcase…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="iconbtn" disabled={running || !manual} onClick={props.onWriteManual} title="Ghi các kết quả test tay vào bản sao file KBKT (không chạy gì)">
          Ghi kết quả test tay
        </button>
        <button className="iconbtn" disabled={running} onClick={importFile} title="Đọc lại file (giữ các liên kết / kết quả đã đánh)">
          Nhập lại
        </button>
        <button className="iconbtn ghost danger" disabled={running} onClick={() => confirm('Bỏ file KBKT khỏi bộ test?') && onChange(undefined)}>
          <X size={12} />
        </button>
      </div>
      {err && <div className="bad">{err}</div>}
      <div className="kbkt-rows">
        {rows.map((r) => {
          const key = kbktKey(r)
          const head = `${r.sheet} › ${r.group}`
          const showHead = head !== lastHead
          lastHead = head
          const cv = caseOf(key)
          return (
            <div key={key}>
              {showHead && (
                <div className="kbkt-group">
                  {r.sheet}
                  {r.group ? ` › ${r.group}` : ''}
                </div>
              )}
              <div className={`kbkt-row ${cv ? `st-${cv.state}` : ''}`} title={`Các bước:\n${r.steps}\n\nKết quả mong muốn:\n${r.expected}`}>
                <span className="kc">{r.code}</span>
                <span className="kp">{r.purpose || r.steps.split('\n')[0]}</span>
                {r.prev && !cv && <span className="muted" title="Kết quả đang có trong file">({r.prev})</span>}
                {cv && (
                  <span className={`ks ${cv.state === 'passed' ? 'ok' : cv.state === 'running' ? '' : 'bad'}`}>
                    {cv.state === 'running' ? 'đang chạy…' : cv.state === 'passed' ? 'ĐẠT' : cv.state === 'stopped' ? 'dừng' : 'LỖI'}
                    {cv.report && (
                      <a className="muted" onClick={() => void window.api.openPath(cv.report!)}> báo cáo</a>
                    )}
                  </span>
                )}
                {r.script ? (
                  <span className="chip" title={r.script}>
                    {fileName(r.script)}
                    <button className="chip-x" disabled={running} title="Bỏ kịch bản" onClick={() => update(key, { script: undefined })}>
                      <X size={10} />
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      className="iconbtn sm-btn"
                      disabled={running}
                      title="Gắn kịch bản tự động kiểm tra testcase này"
                      onClick={async () => {
                        const [s] = await window.api.suite.pickScripts()
                        if (s && !s.error) update(key, { script: s.path, manual: '' })
                      }}
                    >
                      + kịch bản
                    </button>
                    <select
                      className={`input sm res-${r.manual || 'none'}`}
                      value={r.manual ?? ''}
                      disabled={running}
                      title="Kết quả test tay"
                      onChange={(e) => update(key, { manual: e.target.value as KbktLink['manual'] })}
                    >
                      <option value="">test tay…</option>
                      <option value="P">P – đạt</option>
                      <option value="F">F – lỗi</option>
                      <option value="PE">PE – xem xét</option>
                    </select>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SuitePanel({ serial, opts, currentScriptPath, onEditScript }: Props) {
  const [suite, setSuiteState] = useState<Suite>(loadSuite)
  const [path, setPath] = useState<string | null>(() => localStorage.getItem('autoSuitePath'))
  const [dirty, setDirty] = useState(false)
  const [infos, setInfos] = useState<Record<string, ScriptInfo>>({})
  const [dataInfo, setDataInfo] = useState<Record<string, DataInfo>>({})
  const [running, setRunning] = useState(false)
  const [cases, setCases] = useState<CaseInfo[]>([])
  const [caseState, setCaseState] = useState<Record<number, { state: CaseState; attempt: number; message?: string; report?: string }>>({})
  const [live, setLive] = useState<{ index: number; text: string } | null>(null)
  const [result, setResult] = useState<{
    html: string
    xlsx?: string
    kbktOut?: string
    dir: string
    passed: number
    failed: number
    total: number
    error?: string
  } | null>(null)
  const [runDir, setRunDir] = useState('')

  const setSuite = (fn: (s: Suite) => Suite): void => {
    setSuiteState((s) => {
      const n = fn(s)
      localStorage.setItem('autoSuite', JSON.stringify(n))
      return n
    })
    setDirty(true)
  }

  // Script names / step counts for the list.
  useEffect(() => {
    const missing = suite.items.map((i) => i.path).filter((p) => !infos[p])
    if (missing.length)
      void window.api.suite.scriptInfo(missing).then((list) => setInfos((m) => ({ ...m, ...Object.fromEntries(list.map((i) => [i.path, i])) })))
  }, [suite.items]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      window.api.suite.onEvent((e: SuiteEvent) => {
        switch (e.kind) {
          case 'start':
            setCases(e.cases)
            setCaseState({})
            setRunDir(e.dir)
            break
          case 'case':
            setCaseState((s) => ({ ...s, [e.index]: { state: e.state, attempt: e.attempt, message: e.message, report: e.report } }))
            break
          case 'run':
            if (e.event.kind === 'step' && e.event.state === 'running') setLive({ index: e.index, text: `bước ${e.event.index + 1}` })
            break
          case 'end':
            setLive(null)
            setResult({ html: e.html, xlsx: e.xlsx, kbktOut: e.kbktOut, dir: runDir, passed: e.passed, failed: e.failed, total: e.total, error: e.error })
            break
        }
      }),
    [runDir]
  )

  /* ------------------------------------------------------------- actions */

  const addPaths = (list: ScriptInfo[]): void => {
    setInfos((m) => ({ ...m, ...Object.fromEntries(list.map((i) => [i.path, i])) }))
    setSuite((s) => ({ ...s, items: [...s.items, ...list.map((i) => ({ path: i.path, enabled: true, group: s.items[s.items.length - 1]?.group }))] }))
  }
  const updateItem = (i: number, patch: Partial<Suite['items'][number]>): void =>
    setSuite((s) => ({ ...s, items: s.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }))
  const move = (i: number, d: -1 | 1): void =>
    setSuite((s) => {
      const j = i + d
      if (j < 0 || j >= s.items.length) return s
      const items = [...s.items]
      ;[items[i], items[j]] = [items[j], items[i]]
      return { ...s, items }
    })

  const pickData = async (i: number): Promise<void> => {
    const r = await window.api.suite.pickData()
    if (!r) return
    setDataInfo((m) => ({ ...m, [r.path]: { rows: r.rows, columns: r.columns } }))
    updateItem(i, { data: r.path })
  }

  /** Something to run: an enabled script, or an imported KBKT row with a script. */
  const canRun = suite.items.some((i) => i.enabled) || !!suite.kbkt?.rows.some((r) => r.script)
  const [multi, setMulti] = useState(false)

  const run = async (): Promise<void> => {
    if (!canRun) return
    // Ask once for every step that changes data / settings across the suite's scripts.
    const risky: string[] = []
    const paths = [...suite.items.filter((i) => i.enabled).map((i) => i.path), ...(suite.kbkt?.rows ?? []).flatMap((r) => (r.script ? [r.script] : []))]
    const apps = new Set<string>()
    for (const p of [...new Set(paths)]) {
      try {
        const s = await window.api.automation.load(p)
        if (s.app) apps.add(s.app)
        for (const line of destructiveSteps(s)) risky.push(`${s.name} — ${line}`)
      } catch {
        /* unreadable script: the runner reports it */
      }
    }
    const freshWarn = apps.size ? freshRisk(suite.fresh, suite.freshPerms) : null
    if (freshWarn) risky.unshift(`Mỗi testcase: ${freshWarn} (${[...apps].join(', ')})`)
    if (risky.length && !confirm(`Bộ test có ${risky.length} bước sẽ THAY ĐỔI dữ liệu / thiết lập trên điện thoại:\n\n${risky.slice(0, 15).join('\n')}${risky.length > 15 ? '\n…' : ''}\n\nVẫn chạy?`)) return
    autoStore.set({ running: true, unlocked: false, recording: false, inspecting: false, highlight: null })
    setRunning(true)
    setResult(null)
    setCases([])
    try {
      await window.api.suite.run(serial, suite, opts)
    } catch (e) {
      setResult({ html: '', dir: '', passed: 0, failed: 0, total: 0, error: (e as Error).message })
    } finally {
      setRunning(false)
      autoStore.set({ running: false, unlocked: false })
    }
  }

  const save = async (as: boolean): Promise<void> => {
    const p = await window.api.suite.save(suite, as ? null : path)
    if (p) {
      setPath(p)
      localStorage.setItem('autoSuitePath', p)
      setDirty(false)
    }
  }
  const open = async (): Promise<void> => {
    try {
      const r = await window.api.suite.open()
      if (!r) return
      setSuite(() => r.suite)
      setPath(r.path)
      localStorage.setItem('autoSuitePath', r.path)
      setDirty(false)
      setCases([])
      setResult(null)
    } catch (e) {
      setResult({ html: '', dir: '', passed: 0, failed: 0, total: 0, error: (e as Error).message })
    }
  }
  const newSuite = (): void => {
    if (suite.items.length && dirty && !confirm('Bỏ bộ test hiện tại (chưa lưu)?')) return
    setSuite(() => ({ ...emptySuite(), author: suite.author, tester: suite.tester }))
    setPath(null)
    localStorage.removeItem('autoSuitePath')
    setDirty(false)
    setCases([])
    setResult(null)
  }

  /* ------------------------------------------------------------------ ui */

  const icon = (st?: CaseState): React.ReactNode => {
    if (!st || st === 'pending') return <Circle size={12} className="muted-ic" />
    if (st === 'running') return <Loader2 size={12} className="spin" />
    if (st === 'passed') return <CircleCheck size={12} className="ok" />
    if (st === 'stopped') return <Circle size={12} className="muted-ic" />
    return <CircleX size={12} className="bad" />
  }
  const field = (label: string, value: string, set: (v: string) => void, width?: number, placeholder?: string): React.ReactNode => (
    <label className="sfield" style={width ? { flex: `0 0 ${width}px` } : undefined}>
      <span>{label}</span>
      <input className="input sm" value={value} placeholder={placeholder} disabled={running} onChange={(e) => set(e.target.value)} />
    </label>
  )

  return (
    <>
      <div className="auto-row suite-meta">
        {field('Tên bộ test (D2)', suite.name, (v) => setSuite((s) => ({ ...s, name: v })))}
        {field('Mã TC (D3)', suite.code, (v) => setSuite((s) => ({ ...s, code: v.replace(/\s+/g, '_') })), 150, 'VD: MYENG_HOMNAY')}
        {field('Người lập', suite.author, (v) => setSuite((s) => ({ ...s, author: v })), 130)}
        {field('Người test', suite.tester, (v) => setSuite((s) => ({ ...s, tester: v })), 130)}
        <label className="sfield" style={{ flex: '0 0 130px' }} title="Test lỗi sẽ được chạy lại; kết quả ghi vào KQ lần 2 / lần 3">
          <span>Chạy lại khi lỗi</span>
          <select className="input sm" value={suite.retries} disabled={running} onChange={(e) => setSuite((s) => ({ ...s, retries: +e.target.value }))}>
            <option value={0}>không</option>
            <option value={1}>1 lần (KQ lần 2)</option>
            <option value={2}>2 lần (KQ lần 3)</option>
          </select>
        </label>
        <label className="sfield" style={{ flex: '0 0 170px' }} title="Mẫu dùng cho file KBKT xuất ra từ bộ test">
          <span>Mẫu KBKT</span>
          <select
            className="input sm"
            value={!suite.template || suite.template === 'BES' ? 'BES' : suite.template === 'BCCS' ? 'BCCS' : 'custom'}
            disabled={running}
            onChange={async (e) => {
              const v = e.target.value
              if (v !== 'custom') return setSuite((s) => ({ ...s, template: v }))
              try {
                const p = await window.api.suite.pickTemplate()
                if (p) setSuite((s) => ({ ...s, template: p }))
              } catch (err) {
                alert((err as Error).message)
              }
            }}
          >
            <option value="BES">BES</option>
            <option value="BCCS">BCCS</option>
            <option value="custom">{suite.template && suite.template !== 'BES' && suite.template !== 'BCCS' ? `Riêng: ${fileName(suite.template)}` : 'File mẫu riêng…'}</option>
          </select>
        </label>
      </div>
      <div className="auto-row opts">
        <FreshOptions
          fresh={suiteFresh(suite)}
          perms={suite.freshPerms ?? 'keep'}
          app="(theo từng kịch bản)"
          disabled={running}
          onChange={(fresh, freshPerms) => setSuite((s) => ({ ...s, fresh, freshPerms, resetApp: undefined }))}
        />
        <span className="muted">Các tùy chọn quay video, bắt lỗi WebView… lấy theo tab Kịch bản.</span>
      </div>

      <div className="auto-row">
        {running ? (
          <button className="iconbtn danger-solid" onClick={() => void window.api.suite.stop()}>
            <Square size={12} /> Dừng
          </button>
        ) : (
          <button className="iconbtn primary" disabled={!canRun} onClick={run}>
            <Play size={12} /> Chạy bộ test
          </button>
        )}
        <button className={`iconbtn ${multi ? 'on' : ''}`} disabled={running || !canRun} onClick={() => setMulti(!multi)} title="Chạy bộ test này trên nhiều điện thoại cùng lúc">
          <Smartphone size={12} /> Nhiều máy…
        </button>
        <button className="iconbtn" disabled={running} onClick={() => void window.api.suite.pickScripts().then(addPaths)}>
          <Plus size={12} /> Thêm kịch bản…
        </button>
        {currentScriptPath && (
          <button
            className="iconbtn"
            disabled={running}
            title={currentScriptPath}
            onClick={() => void window.api.suite.scriptInfo([currentScriptPath]).then(addPaths)}
          >
            <Plus size={12} /> Kịch bản đang mở
          </button>
        )}
        <span className="spacer" />
        {dirty && <span className="muted-ic" title="có thay đổi chưa lưu">●</span>}
        <button className="iconbtn" title="Bộ test mới" disabled={running} onClick={newSuite}><FilePlus2 size={13} /></button>
        <button className="iconbtn" title="Mở bộ test" disabled={running} onClick={open}><FolderOpen size={13} /></button>
        <button className="iconbtn" title="Lưu bộ test (Shift+click: lưu thành file khác)" onClick={(e) => void save(e.shiftKey || !path)}><Save size={13} /></button>
      </div>

      {multi && <MultiRunBox suite={suite} opts={opts} canRun={canRun} busy={running} onClose={() => setMulti(false)} />}

      <div className="steps">
        {suite.items.length === 0 && (
          <div className="steps-empty">
            Bộ test gồm nhiều kịch bản — mỗi kịch bản là một testcase (một dòng trong file KBKT).
            <br />
            Bấm <b>Thêm kịch bản…</b> để chọn các file <code>.json</code> đã lưu, đặt <b>nhóm</b> (dòng vàng trong KBKT), gắn file <b>CSV</b> nếu muốn chạy
            cùng kịch bản với nhiều bộ dữ liệu (dùng <code>{'${tên_cột}'}</code> trong các bước), rồi bấm <b>Chạy bộ test</b>.
          </div>
        )}
        {suite.items.map((it, i) => {
          const info = infos[it.path]
          const di = it.data ? dataInfo[it.data] : undefined
          const states = cases.filter((c) => c.item === i).map((c) => ({ c, s: caseState[c.index] }))
          return (
            <div key={i} className={`step suite-item ${it.enabled ? '' : 'disabled'}`}>
              <input type="checkbox" checked={it.enabled} disabled={running} onChange={(e) => updateItem(i, { enabled: e.target.checked })} title="Bật / tắt" />
              <div className="body">
                <div className="d">
                  <b>{info?.name ?? fileName(it.path)}</b>{' '}
                  <span className="muted">
                    {info?.error ? <span className="bad">{info.error}</span> : `${info?.steps ?? '?'} bước · ${fileName(it.path)}`}
                  </span>
                </div>
                <div className="f">
                  <input
                    className="input sm grow"
                    placeholder="Nhóm (dòng vàng trong KBKT) — VD: Giao diện, Chức năng…"
                    value={it.group ?? ''}
                    disabled={running}
                    onChange={(e) => updateItem(i, { group: e.target.value })}
                  />
                  {it.data ? (
                    <span className="chip" title={`${it.data}${di ? `\nCột: ${di.columns.join(', ')}` : ''}`}>
                      <Table size={11} /> {fileName(it.data)}
                      {di ? ` · ${di.rows} dòng` : ''}
                      <button className="chip-x" disabled={running} onClick={() => updateItem(i, { data: undefined })}>
                        <X size={10} />
                      </button>
                    </span>
                  ) : (
                    <button className="iconbtn" disabled={running} onClick={() => void pickData(i)} title="Chạy kịch bản này một lần cho mỗi dòng của file CSV">
                      <Table size={12} /> Dữ liệu CSV
                    </button>
                  )}
                </div>
                {states.length > 0 && (
                  <div className="case-list">
                    {states.map(({ c, s }) => (
                      <div key={c.index} className={`case st-${s?.state ?? 'pending'}`}>
                        {icon(s?.state)}
                        <span className="ct">{c.title}</span>
                        <span className="cs">
                          {s ? STATE_LABEL[s.state] : 'chờ'}
                          {s && s.attempt > 1 ? ` (lần ${s.attempt})` : ''}
                          {live?.index === c.index ? ` · ${live.text}` : ''}
                        </span>
                        {s?.report && (
                          <a className="muted" onClick={() => void window.api.openPath(s.report!)}>báo cáo</a>
                        )}
                        {s?.message && s.state !== 'passed' && <div className="cm">{s.message}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {!running && (
                <span className="acts">
                  <button className="iconbtn ghost" title="Sửa kịch bản" onClick={() => onEditScript(it.path)}><Pencil size={12} /></button>
                  <button className="iconbtn ghost" title="Lên" onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
                  <button className="iconbtn ghost" title="Xuống" onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
                  <button className="iconbtn ghost danger" title="Bỏ khỏi bộ test" onClick={() => setSuite((s) => ({ ...s, items: s.items.filter((_, k) => k !== i) }))}>
                    <Trash2 size={12} />
                  </button>
                </span>
              )}
            </div>
          )
        })}
        <KbktSection
          kbkt={suite.kbkt}
          running={running}
          caseOf={(key) => {
            const c = cases.find((x) => x.kbkt === key)
            return c ? caseState[c.index] : undefined
          }}
          onChange={(k) => setSuite((s) => ({ ...s, kbkt: k }))}
          onWriteManual={async () => {
            try {
              const r = await window.api.suite.writeManual(suite)
              setResult({ html: '', dir: '', passed: 0, failed: 0, total: 0, kbktOut: r.path, error: r.count ? undefined : 'Chưa có dòng nào được đánh kết quả test tay' })
            } catch (e) {
              setResult({ html: '', dir: '', passed: 0, failed: 0, total: 0, error: (e as Error).message })
            }
          }}
        />
      </div>

      {result && (
        <div className="suite-result">
          {result.error && <div className="bad">{result.error}</div>}
          {result.total > 0 && (
            <div className="sr-sum">
              <b className="ok">{result.passed} đạt</b> · <b className="bad">{result.failed} lỗi</b> · {result.total - result.passed - result.failed} chưa chạy / {result.total} testcase
            </div>
          )}
          <div className="sr-links">
            {result.html && (
              <button className="iconbtn" onClick={() => void window.api.openPath(result.html)}>
                <FileText size={12} /> Báo cáo tổng hợp
              </button>
            )}
            {result.xlsx && (
              <button className="iconbtn primary" onClick={() => void window.api.openPath(result.xlsx!)}>
                <FileSpreadsheet size={12} /> Mở file KBKT (Excel)
              </button>
            )}
            {result.kbktOut && (
              <button className="iconbtn primary" onClick={() => void window.api.openPath(result.kbktOut!)} title={result.kbktOut}>
                <FileSpreadsheet size={12} /> Mở file KBKT đã điền kết quả
              </button>
            )}
            {(result.xlsx || result.html || result.kbktOut) && (
              <button className="iconbtn" onClick={() => void window.api.reveal(result.kbktOut ?? result.xlsx ?? result.html)}>
                <FolderOpen size={12} /> Thư mục
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
