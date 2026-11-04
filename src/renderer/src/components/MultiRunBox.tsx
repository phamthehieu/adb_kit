import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, Play, Smartphone, Square, X } from 'lucide-react'
import { freshRisk, type DeviceRun, type RunOptions, type Suite } from '@shared/automation'
import type { DeviceInfo } from '@shared/types'
import { autoStore } from '../lib/automation'
import { ask } from '../lib/dialog'

/** "Chạy trên nhiều máy": pick connected phones, run the suite on all at once, see progress. */
export function MultiRunBox({ suite, opts, canRun, busy, onClose }: { suite: Suite; opts: RunOptions; canRun: boolean; busy: boolean; onClose: () => void }) {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<DeviceRun[]>([])
  const [html, setHtml] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    const apply = (l: DeviceInfo[]): void => {
      const ready = l.filter((d) => d.state === 'device')
      setDevices(ready)
      setPicked((p) => (p.size ? p : new Set(ready.map((d) => d.serial))))
    }
    void window.api.listDevices().then(apply)
    const off1 = window.api.onDevices(apply)
    const off2 = window.api.suite.onMulti((e) => {
      setProgress(e.devices)
      if (e.kind === 'done') setHtml(e.html)
    })
    return () => {
      off1()
      off2()
    }
  }, [])

  const toggle = (s: string): void =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })

  const run = async (): Promise<void> => {
    const freshWarn = freshRisk(suite.fresh, suite.freshPerms)
    if (freshWarn && !(await ask(`Trên ${picked.size} điện thoại, mỗi testcase sẽ ${freshWarn}.`, { title: 'Chạy trên nhiều máy', danger: true, ok: 'Vẫn chạy' }))) return
    setErr('')
    setHtml('')
    setProgress([])
    setRunning(true)
    autoStore.set({ running: true, unlocked: false, recording: false, inspecting: false, highlight: null })
    try {
      await window.api.suite.runMulti([...picked], suite, opts)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRunning(false)
      autoStore.set({ running: false, unlocked: false })
    }
  }

  return (
    <div className="multi-box">
      <div className="mini-head">
        <Smartphone size={14} />
        <b>Chạy trên nhiều máy cùng lúc</b>
        <span className="muted">mỗi máy một báo cáo + KBKT riêng, và một bảng tổng hợp testcase × máy</span>
        <span className="spacer" />
        {!running && (
          <button className="iconbtn ghost" onClick={onClose} title="Đóng"><X size={13} /></button>
        )}
      </div>
      {!running && !progress.length && (
        <>
          <div className="multi-devs">
            {devices.map((d) => (
              <label key={d.serial} className="mini-check">
                <input type="checkbox" checked={picked.has(d.serial)} onChange={() => toggle(d.serial)} /> {d.model} <span className="muted">{d.serial}</span>
              </label>
            ))}
            {devices.length < 2 && <span className="muted">Cắm thêm điện thoại (hoặc kết nối qua Wi-Fi) để chạy song song.</span>}
          </div>
          <div className="bug-actions">
            <span className="muted">Máy đang hiển thị dùng mirror; các máy khác dùng lệnh adb input (không cần mở màn hình).</span>
            <span className="spacer" />
            <button className="iconbtn primary" disabled={!canRun || busy || picked.size === 0} onClick={() => void run()}>
              <Play size={12} /> Chạy trên {picked.size} máy
            </button>
          </div>
        </>
      )}
      {progress.length > 0 && (
        <table className="mini-table">
          <thead>
            <tr>
              <th>Máy</th>
              <th>Tiến độ</th>
              <th>Đạt</th>
              <th>Lỗi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {progress.map((d) => {
              const doneN = d.states.filter((s) => s !== 'pending' && s !== 'running').length
              const total = d.cases.length || 1
              const now = d.states.findIndex((s) => s === 'running')
              const passed = d.states.filter((s) => s === 'passed').length
              const failed = d.states.filter((s) => s === 'failed' || s === 'crashed').length
              return (
                <tr key={d.serial}>
                  <td>
                    <b>{d.model}</b>
                    {now >= 0 && <div className="muted">đang chạy: {d.cases[now]}</div>}
                    {d.error && <div className="bad">{d.error}</div>}
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <div className="multi-bar">
                      <div style={{ width: `${(doneN / total) * 100}%` }} className={failed ? 'bad' : ''} />
                    </div>
                    <span className="muted">
                      {doneN}/{d.cases.length}
                      {d.done ? ' · xong' : ''}
                    </span>
                  </td>
                  <td className="mono ok">{passed}</td>
                  <td className="mono bad">{failed}</td>
                  <td className="mini-act">
                    {d.html && (
                      <button className="iconbtn ghost" onClick={() => void window.api.openPath(d.html!)} title="Báo cáo của máy này">
                        <ExternalLink size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {err && <div className="ck-note bad">{err}</div>}
      <div className="bug-actions">
        {running && (
          <>
            <Loader2 size={13} className="spin" />
            <span className="muted">Đang chạy trên {progress.length || picked.size} máy…</span>
            <span className="spacer" />
            <button className="iconbtn danger-solid" onClick={() => void window.api.suite.stopMulti()}>
              <Square size={12} /> Dừng tất cả
            </button>
          </>
        )}
        {html && (
          <>
            <span className="spacer" />
            <button className="iconbtn primary" onClick={() => void window.api.openPath(html)}>
              <ExternalLink size={12} /> Mở bảng tổng hợp
            </button>
            <button className="iconbtn" onClick={() => { setProgress([]); setHtml('') }}>Chạy lại</button>
          </>
        )}
      </div>
    </div>
  )
}
