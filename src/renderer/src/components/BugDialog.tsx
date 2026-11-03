import { useEffect, useMemo, useRef, useState } from 'react'
import { Bug, Check, ClipboardCopy, FileText, FolderOpen, Loader2, Video, X } from 'lucide-react'
import { describeStep } from '@shared/automation'
import { SEVERITIES, type BugResult, type BugSnap, type Severity } from '@shared/bug'
import { recentTrail } from '../lib/automation'
import { grabRolling, rollingEnabled, setRollingEnabled } from '../lib/rollingVideo'
import { PackagePicker } from './PackagePicker'
import { JiraBox } from './JiraBox'

export type Clip = { data: Uint8Array; startedAt: number; endedAt: number }

/**
 * One-click bug report for testers: the evidence (screenshot, last seconds of video, logcat,
 * crash, UI tree, recent API / bridge calls, the tester's last actions) is captured the moment
 * the dialog opens; the tester only types a title and what went wrong.
 */
/** Evidence already captured (e.g. the moment a crash was detected) plus prefilled text. */
export interface BugPreset {
  snap: BugSnap
  clips: Clip[]
  trail: { at: number; text: string }[]
  title: string
  actual: string
}

export function BugDialog({ serial, onClose, preset }: { serial: string; onClose: () => void; preset?: BugPreset }) {
  const [snap, setSnap] = useState<BugSnap | null>(preset?.snap ?? null)
  const [clips, setClips] = useState<Clip[]>(preset?.clips ?? [])
  const [trail] = useState(() => preset?.trail ?? recentTrail().map((t) => ({ at: t.at, text: describeStep(t.step) })))
  const [error, setError] = useState('')
  const [title, setTitle] = useState(preset?.title ?? '')
  const [actual, setActual] = useState(preset?.actual ?? '')
  const [expected, setExpected] = useState('')
  const [severity, setSeverity] = useState<Severity>(() => (localStorage.getItem('bugSeverity') as Severity) || 'Trung bình')
  const [pkg, setPkg] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<BugResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [video, setVideo] = useState(rollingEnabled)
  const done = useRef(false)
  const snapId = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    if (preset) {
      snapId.current = preset.snap.id
      setPkg(preset.snap.pkg ?? '')
      return () => {
        if (!done.current && snapId.current) void window.api.bug.discard(snapId.current)
      }
    }
    void grabRolling().then((c) => alive && setClips(c)).catch(() => {})
    window.api.bug
      .snap(serial)
      .then((s) => {
        snapId.current = s.id
        if (!alive) return void window.api.bug.discard(s.id)
        setSnap(s)
        setPkg(s.pkg ?? '')
      })
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
      // Closed without saving: don't leave a half-made report folder behind.
      if (!done.current && snapId.current) void window.api.bug.discard(snapId.current)
    }
  }, [serial])

  const shotUrl = useMemo(() => (snap ? URL.createObjectURL(new Blob([snap.png as BlobPart], { type: 'image/png' })) : ''), [snap])
  useEffect(() => () => URL.revokeObjectURL(shotUrl), [shotUrl])

  const videoSec = Math.round(clips.reduce((n, c) => n + (c.endedAt - c.startedAt), 0) / 1000)

  const save = async (): Promise<void> => {
    if (!snap) return
    setSaving(true)
    setError('')
    localStorage.setItem('bugSeverity', severity)
    try {
      const r = await window.api.bug.save(snap.id, { title: title.trim(), actual: actual.trim(), expected: expected.trim(), severity, pkg, videos: clips, trail })
      done.current = true
      setResult(r)
      await navigator.clipboard.writeText(r.markdown).then(() => setCopied(true)).catch(() => {})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const toggleVideo = (on: boolean): void => {
    setVideo(on)
    setRollingEnabled(on)
  }

  // Esc closes; Ctrl+Enter saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !saving) onClose()
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !result && snap && !saving) void save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="bug-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="bug-dialog" role="dialog" aria-label="Báo lỗi">
        <div className="bug-head">
          <Bug size={16} />
          <b>{result ? 'Đã tạo báo cáo lỗi' : 'Báo lỗi'}</b>
          <span className="muted">{result ? '' : 'Ảnh, video, log và API đã được lưu ngay lúc bấm — chỉ cần mô tả lỗi'}</span>
          <span className="spacer" />
          <button className="iconbtn ghost" onClick={onClose} disabled={saving} title="Đóng (Esc)"><X size={14} /></button>
        </div>

        {result ? (
          <div className="bug-done">
            <div className="bug-ok">
              <Check size={16} /> {copied ? 'Nội dung lỗi đã được sao chép — dán thẳng vào Jira / Redmine / Teams.' : 'Đã lưu báo cáo.'} Đính kèm file zip vào ticket.
            </div>
            <textarea className="input bug-md" readOnly value={result.markdown} />
            <JiraBox result={result} title={title.trim()} severity={severity} />
            <div className="bug-actions">
              <button className="iconbtn" onClick={() => void navigator.clipboard.writeText(result.markdown).then(() => setCopied(true))}>
                <ClipboardCopy size={13} /> Sao chép nội dung
              </button>
              <button className="iconbtn" onClick={() => void window.api.openPath(result.html)}><FileText size={13} /> Mở báo cáo</button>
              <button className="iconbtn" onClick={() => void window.api.reveal(result.zip)}><FolderOpen size={13} /> Mở thư mục (file zip)</button>
              <span className="spacer" />
              <button className="iconbtn primary" onClick={onClose}>Xong</button>
            </div>
          </div>
        ) : (
          <div className="bug-body">
            <div className="bug-evidence">
              {shotUrl ? <img src={shotUrl} alt="Ảnh màn hình" /> : <div className="bug-shot-wait">{error ? '' : <Loader2 size={20} className="spin" />}</div>}
              <div className="bug-chips">
                <span className={`bug-chip ${clips.length ? 'ok' : ''}`}>
                  <Video size={11} /> {clips.length ? `Video ${videoSec} giây gần nhất` : video ? 'Chưa có video (màn hình đứng yên)' : 'Không quay video'}
                </span>
                <span className={`bug-chip ${trail.length ? 'ok' : ''}`}>{trail.length} thao tác gần nhất</span>
                {snap && (
                  <span className={`bug-chip ${snap.calls ? 'ok' : ''}`} title={snap.calls ? '' : 'Bật tab Mạng / API cho app này trước khi tái hiện lỗi để kèm cả API'}>
                    {snap.calls ? `${snap.calls} API/bridge${snap.failedCalls ? ` · ${snap.failedCalls} lỗi` : ''}` : 'Chưa có API (bật tab Mạng / API)'}
                  </span>
                )}
                {snap?.errors ? <span className="bug-chip bad">{snap.errors} lỗi JS/WebView</span> : null}
                {snap?.crash ? <span className="bug-chip bad">App vừa crash</span> : null}
                {snap && <span className="bug-chip ok">Logcat · cây giao diện</span>}
              </div>
              {snap?.activity && <div className="bug-act muted" title="Màn đang mở">{snap.activity}</div>}
            </div>

            <div className="bug-form">
              <label>
                <span>Tiêu đề lỗi</span>
                <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="vd. Bấm Thanh toán không phản hồi" />
              </label>
              <div className="bug-row">
                <label>
                  <span>Mức độ</span>
                  <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                    {SEVERITIES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="grow">
                  <span>App</span>
                  <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="App bị lỗi…" />
                </label>
              </div>
              <label>
                <span>Kết quả thực tế</span>
                <textarea className="input" rows={3} value={actual} onChange={(e) => setActual(e.target.value)} placeholder="Điều gì đã xảy ra?" />
              </label>
              <label>
                <span>Kết quả mong muốn</span>
                <textarea className="input" rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Đáng lẽ phải thế nào?" />
              </label>
              {trail.length > 0 && (
                <details className="bug-trail">
                  <summary>Các bước tái hiện (tự ghi từ thao tác trên màn mirror)</summary>
                  <ol>
                    {trail.map((t, i) => (
                      <li key={i}>{t.text}</li>
                    ))}
                  </ol>
                </details>
              )}
              {error && <div className="bad">{error}</div>}
              <div className="bug-actions">
                <label className="mini-check" title="Luôn giữ sẵn 20–40 giây video gần nhất của màn mirror (tốn một ít CPU)">
                  <input type="checkbox" checked={video} onChange={(e) => toggleVideo(e.target.checked)} /> Quay sẵn video
                </label>
                <span className="spacer" />
                <button className="iconbtn" onClick={onClose} disabled={saving}>Hủy</button>
                <button className="iconbtn primary" onClick={() => void save()} disabled={!snap || saving} title="Ctrl + Enter">
                  {saving ? <Loader2 size={13} className="spin" /> : <Bug size={13} />} Tạo báo cáo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
