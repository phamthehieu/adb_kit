import { useEffect, useMemo, useRef, useState } from 'react'
import { Bug, CheckCheck, Check, CircleHelp, FileSpreadsheet, FolderOpen, Loader2, RotateCcw, X } from 'lucide-react'
import { kbktKey, type KbktImport, type KbktLink, type Suite } from '@shared/automation'
import { MANUAL_LABEL, type ManualResult } from '@shared/manual'
import { loadSuite, saveSuite } from '../lib/suiteStore'
import { grabRolling } from '../lib/rollingVideo'

type Filter = 'all' | 'todo' | 'F' | 'P'
const RESULT_ICON: Record<ManualResult, React.ReactNode> = { P: <Check size={14} />, F: <X size={14} />, PE: <CircleHelp size={14} /> }

const loadOpts = (): { video: boolean; log: boolean; advance: boolean } => {
  try {
    return { video: true, log: true, advance: true, ...JSON.parse(localStorage.getItem('manualOpts') ?? '{}') }
  } catch {
    return { video: true, log: true, advance: true }
  }
}

/**
 * Manual testing against a KBKT file. Pick a test case, follow its steps on the phone, press Đạt /
 * Lỗi / Xem xét: ADB Kit saves a screenshot (plus log and the last seconds of video for failures)
 * in a folder, and the KBKT cell links to it — nobody attaches files by hand.
 */
export function ManualTestPanel({ serial }: { serial: string }) {
  const [suite, setSuiteState] = useState<Suite>(loadSuite)
  const [sel, setSel] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; path?: string; bug?: boolean } | null>(null)
  const [opts, setOptsState] = useState(loadOpts)
  const detail = useRef<HTMLDivElement>(null)

  const kbkt = suite.kbkt
  const setOpts = (o: typeof opts): void => {
    localStorage.setItem('manualOpts', JSON.stringify(o))
    setOptsState(o)
  }
  const setSuite = (n: Suite): void => {
    saveSuite(n)
    setSuiteState(n)
  }
  const update = (key: string, patch: Partial<KbktLink>): void => {
    if (!kbkt) return
    setSuite({ ...suite, kbkt: { ...kbkt, rows: kbkt.rows.map((r) => (kbktKey(r) === key ? { ...r, ...patch } : r)) } })
  }

  const counts = useMemo(() => {
    const rows = kbkt?.rows ?? []
    return { total: rows.length, P: rows.filter((r) => r.manual === 'P').length, F: rows.filter((r) => r.manual === 'F').length, PE: rows.filter((r) => r.manual === 'PE').length }
  }, [kbkt])
  const done = counts.P + counts.F + counts.PE

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (kbkt?.rows ?? []).filter((r) => {
      if (filter === 'todo' && r.manual) return false
      if (filter === 'F' && r.manual !== 'F') return false
      if (filter === 'P' && r.manual !== 'P') return false
      return !s || `${r.code} ${r.group} ${r.purpose} ${r.sheet}`.toLowerCase().includes(s)
    })
  }, [kbkt, filter, q])

  const cur = kbkt?.rows.find((r) => kbktKey(r) === sel) ?? null
  const choose = (r: KbktLink | undefined): void => {
    if (!r) return
    setSel(kbktKey(r))
    setNote(r.note ?? '')
    setMsg(null)
    detail.current?.scrollTo({ top: 0 })
  }
  // Open on the first test case that has no result yet.
  useEffect(() => {
    if (kbkt && !sel) choose(kbkt.rows.find((r) => !r.manual) ?? kbkt.rows[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbkt?.file])

  const move = (dir: 1 | -1): void => {
    const i = rows.findIndex((r) => kbktKey(r) === sel)
    choose(rows[Math.min(rows.length - 1, Math.max(0, i + dir))])
  }
  const nextTodo = (from: string): KbktLink | undefined => {
    const all = kbkt?.rows ?? []
    const i = all.findIndex((r) => kbktKey(r) === from)
    return [...all.slice(i + 1), ...all.slice(0, i)].find((r) => !r.manual)
  }

  const importKbkt = async (): Promise<void> => {
    try {
      const r = await window.api.suite.importKbkt()
      if (!r) return
      const prev = new Map((kbkt?.rows ?? []).map((x) => [kbktKey(x), x]))
      const next: KbktImport = { ...r, rows: r.rows.map((x) => ({ ...x, ...(prev.get(kbktKey(x)) ? { script: prev.get(kbktKey(x))!.script, manual: prev.get(kbktKey(x))!.manual, note: prev.get(kbktKey(x))!.note, evidence: prev.get(kbktKey(x))!.evidence } : {}) })) }
      setSuite({ ...suite, kbkt: next })
      setSel(null)
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
    }
  }

  const record = async (result: ManualResult): Promise<void> => {
    if (!cur || !kbkt || busy) return
    const key = kbktKey(cur)
    setBusy(true)
    setMsg(null)
    let evidence: string | undefined
    let warn = ''
    try {
      const videos = result === 'F' && opts.video ? await grabRolling().catch(() => []) : []
      const ev = await window.api.manual.capture(serial, {
        kbkt: kbkt.file,
        sheet: cur.sheet,
        row: cur.row,
        code: cur.code,
        purpose: cur.purpose,
        steps: cur.steps,
        expected: cur.expected,
        result,
        note: note.trim(),
        withLog: opts.log,
        videos
      })
      evidence = ev.html
    } catch (e) {
      warn = (e as Error).message
    }
    update(key, { manual: result, note: note.trim(), evidence, testedAt: Date.now() })
    setBusy(false)
    if (warn) setMsg({ text: `Đã ghi kết quả “${MANUAL_LABEL[result]}” nhưng CHƯA có bằng chứng: ${warn}`, bad: true })
    else setMsg({ text: `Đã ghi “${MANUAL_LABEL[result]}” kèm bằng chứng`, path: evidence, bug: result === 'F' })
    if (opts.advance) {
      const n = nextTodo(key)
      if (n) {
        setSel(kbktKey(n))
        setNote(n.note ?? '')
      }
    }
  }

  // Keyboard: Alt+1 Đạt · Alt+2 Lỗi · Alt+3 Xem xét · Alt+↑/↓ chuyển testcase
  const recordRef = useRef(record)
  recordRef.current = record
  const moveRef = useRef(move)
  moveRef.current = move
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (!e.altKey) return
      const map: Record<string, ManualResult> = { '1': 'P', '2': 'F', '3': 'PE' }
      if (map[e.key]) {
        e.preventDefault()
        void recordRef.current(map[e.key])
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        moveRef.current(e.key === 'ArrowDown' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const writeKbkt = async (): Promise<void> => {
    try {
      const r = await window.api.suite.writeManual(suite)
      setMsg({ text: `Đã ghi ${r.count} kết quả vào bản sao KBKT (ô liên kết tới bằng chứng)`, path: r.path })
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
    }
  }

  const reportBug = (): void => {
    if (!cur) return
    window.dispatchEvent(
      new CustomEvent('adbkit:report-bug', {
        detail: { title: `[${cur.code || `dòng ${cur.row}`}] ${cur.purpose}`.slice(0, 160), actual: `${note.trim() || '(mô tả lỗi)'}\n\nCác bước:\n${cur.steps}\n\nKết quả mong muốn:\n${cur.expected}` }
      })
    )
  }

  if (!kbkt) {
    return (
      <div className="mt-empty">
        <FileSpreadsheet size={34} className="muted-ic" />
        <h3>Test tay theo file KBKT</h3>
        <p>
          Nhập file KBKT (mẫu BES hoặc BCCS) rồi lần lượt test từng dòng trên điện thoại. Mỗi lần bấm <b>Đạt</b>, <b>Lỗi</b> hay <b>Xem xét</b>, ADB Kit tự chụp màn hình (lỗi thì kèm log và video 20 giây vừa rồi) và gắn liên kết vào đúng ô của KBKT.
        </p>
        <button className="iconbtn primary" onClick={() => void importKbkt()}>
          <FileSpreadsheet size={14} /> Nhập file KBKT…
        </button>
        {msg && <div className="bad">{msg.text}</div>}
      </div>
    )
  }

  let lastHead = ''
  const stepLines = (cur?.steps ?? '').split('\n').filter((l) => l.trim())
  return (
    <div className="mt-wrap">
      <div className="mt-head">
        <FileSpreadsheet size={14} />
        <b title={kbkt.file}>{kbkt.file.split(/[\\/]/).pop()}</b>
        <span className="muted">
          {done}/{counts.total} đã test
        </span>
        <span className="mt-bar" title={`Đạt ${counts.P} · Lỗi ${counts.F} · Xem xét ${counts.PE}`}>
          <i className="p" style={{ width: `${(counts.P / Math.max(1, counts.total)) * 100}%` }} />
          <i className="pe" style={{ width: `${(counts.PE / Math.max(1, counts.total)) * 100}%` }} />
          <i className="f" style={{ width: `${(counts.F / Math.max(1, counts.total)) * 100}%` }} />
        </span>
        <span className="mt-cnt p">{counts.P} đạt</span>
        <span className="mt-cnt f">{counts.F} lỗi</span>
        {counts.PE > 0 && <span className="mt-cnt pe">{counts.PE} xem xét</span>}
        <span className="spacer" />
        <button className="iconbtn" onClick={() => void window.api.manual.openRoot()} title="Mở thư mục chứa bằng chứng của mọi lần test tay">
          <FolderOpen size={13} /> <span className="btn-t">Bằng chứng</span>
        </button>
        <button className="iconbtn primary" disabled={!done} onClick={() => void writeKbkt()} title="Ghi các kết quả vào một bản sao file KBKT; ô kết quả có liên kết tới bằng chứng">
          <CheckCheck size={13} /> Ghi vào KBKT
        </button>
      </div>

      <div className="mt-filter">
        {(
          [
            ['all', `Tất cả (${counts.total})`],
            ['todo', `Chưa test (${counts.total - done})`],
            ['F', `Lỗi (${counts.F})`],
            ['P', `Đạt (${counts.P})`]
          ] as [Filter, string][]
        ).map(([k, t]) => (
          <button key={k} className={`mt-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
            {t}
          </button>
        ))}
        <input className="input sm" style={{ width: 170 }} placeholder="Tìm testcase…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="mt-split">
        <div className="mt-list" role="listbox" aria-label="Danh sách testcase">
          {rows.length === 0 && <div className="steps-empty">Không có testcase nào khớp.</div>}
          {rows.map((r) => {
            const key = kbktKey(r)
            const head = `${r.sheet} › ${r.group}`
            const showHead = head !== lastHead
            lastHead = head
            return (
              <div key={key}>
                {showHead && <div className="kbkt-group">{r.group || r.sheet}</div>}
                <button className={`mt-row ${key === sel ? 'sel' : ''}`} role="option" aria-selected={key === sel} onClick={() => choose(r)}>
                  <span className={`mt-dot ${r.manual || 'none'}`}>{r.manual ? RESULT_ICON[r.manual as ManualResult] : null}</span>
                  <span className="mt-code">{r.code}</span>
                  <span className="mt-purpose">{r.purpose}</span>
                </button>
              </div>
            )
          })}
        </div>

        <div className="mt-detail" ref={detail}>
          {!cur ? (
            <div className="steps-empty">Chọn một testcase ở bên trái.</div>
          ) : (
            <>
              <div className="mt-crumb">{[cur.sheet, cur.group].filter(Boolean).join(' › ')}</div>
              <h3 className="mt-title">
                {cur.code && <span className="mt-code">{cur.code}</span>} {cur.purpose}
              </h3>
              {cur.manual && (
                <div className={`mt-prev ${cur.manual}`}>
                  Kết quả hiện tại: <b>{MANUAL_LABEL[cur.manual as ManualResult]}</b>
                  {cur.testedAt ? ` · ${new Date(cur.testedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                  {cur.evidence && (
                    <button className="iconbtn sm-btn" onClick={() => void window.api.openPath(cur.evidence!)}>
                      Xem bằng chứng
                    </button>
                  )}
                  <button className="iconbtn ghost sm-btn" title="Bỏ kết quả này" onClick={() => update(kbktKey(cur), { manual: '', evidence: undefined, testedAt: undefined })}>
                    <RotateCcw size={12} /> Bỏ kết quả
                  </button>
                </div>
              )}

              <div className="mt-sec">
                <div className="mt-cap">Các bước</div>
                <ol className="mt-steps">
                  {stepLines.length ? stepLines.map((l, i) => <li key={i}>{l.replace(/^\s*\d+[.)]\s*/, '')}</li>) : <li className="muted">(không có)</li>}
                </ol>
              </div>
              <div className="mt-sec expected">
                <div className="mt-cap">Kết quả mong muốn</div>
                <div className="mt-exp">{cur.expected || <span className="muted">(không có)</span>}</div>
              </div>

              <div className="mt-sec">
                <div className="mt-cap">Ghi chú (đi kèm kết quả)</div>
                <textarea className="input mt-note" rows={2} placeholder="Ví dụ: Bấm Xác nhận xong màn hình trắng 5 giây rồi báo lỗi 500" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="mt-opts">
                  <label className="check" title="Khi bấm Lỗi, kèm video khoảng 20 giây vừa rồi của màn hình">
                    <input type="checkbox" checked={opts.video} onChange={(e) => setOpts({ ...opts, video: e.target.checked })} /> Lỗi: kèm video 20 giây
                  </label>
                  <label className="check" title="Khi bấm Lỗi / Xem xét, kèm logcat (và crash nếu có)">
                    <input type="checkbox" checked={opts.log} onChange={(e) => setOpts({ ...opts, log: e.target.checked })} /> Lỗi: kèm log
                  </label>
                  <label className="check" title="Chấm xong tự chuyển sang testcase chưa test kế tiếp">
                    <input type="checkbox" checked={opts.advance} onChange={(e) => setOpts({ ...opts, advance: e.target.checked })} /> Tự chuyển testcase kế
                  </label>
                </div>
              </div>

              <div className="mt-actions">
                <button className="mt-btn p" disabled={busy} onClick={() => void record('P')} title="Alt+1">
                  {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Đạt <kbd>Alt+1</kbd>
                </button>
                <button className="mt-btn f" disabled={busy} onClick={() => void record('F')} title="Alt+2">
                  <X size={16} /> Lỗi <kbd>Alt+2</kbd>
                </button>
                <button className="mt-btn pe" disabled={busy} onClick={() => void record('PE')} title="Alt+3">
                  <CircleHelp size={16} /> Xem xét <kbd>Alt+3</kbd>
                </button>
                <span className="spacer" />
                <button className="iconbtn" onClick={() => move(-1)} title="Alt+↑">‹ Trước</button>
                <button className="iconbtn" onClick={() => move(1)} title="Alt+↓">Sau ›</button>
              </div>

              {msg && (
                <div className={`mt-msg ${msg.bad ? 'bad' : 'ok'}`}>
                  {msg.text}
                  {msg.path && (
                    <button className="iconbtn sm-btn" onClick={() => void (msg.path!.endsWith('.html') ? window.api.openPath(msg.path!) : window.api.manual.reveal(msg.path!))}>
                      Mở
                    </button>
                  )}
                  {msg.bug && (
                    <button className="iconbtn sm-btn danger-outline" onClick={reportBug} title="Mở hộp báo lỗi với tiêu đề và các bước đã điền sẵn">
                      <Bug size={12} /> Tạo báo lỗi
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
