import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw, TriangleAlert, Undo2 } from 'lucide-react'
import { STRESS_GROUPS, STRESS_ITEMS, type StressGroup, type StressItem, type StressResult, type StressStatus } from '@shared/stress'
import { PackagePicker } from './PackagePicker'
import { ask } from '../lib/dialog'

const GROUP_ORDER: StressGroup[] = ['process', 'power', 'display', 'locale', 'network', 'storage']

/**
 * "Độ bền": one-tap ways to put the phone or the app under test into the situations real users hit
 * and test benches never do. Everything that changes a setting is remembered and can be put back
 * with one button, even after ADB Kit was closed in between.
 */
export function StressPanel({ serial }: { serial: string }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('stressPkg') ?? localStorage.getItem('netPkg') ?? '')
  const [status, setStatus] = useState<StressStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, StressResult>>({})
  const [choice, setChoice] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.api.stress.status(serial))
    } catch {
      setStatus(null)
    }
  }, [serial])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (pkg) localStorage.setItem('stressPkg', pkg)
  }, [pkg])

  const applied = new Map((status?.applied ?? []).map((a) => [a.id, a]))
  const label = (id: string): string => STRESS_ITEMS.find((i) => i.id === id)?.label ?? id

  const explain = (e: unknown): string =>
    window.api.stress
      ? (e as Error).message
      : 'Cửa sổ này đang chạy phần cũ của ADB Kit (chưa có tính năng này). Hãy đóng hẳn ADB Kit rồi mở lại — nếu đang chạy bản dev thì tắt và chạy lại npm run dev.'

  const finish = (id: string, r: StressResult): void => setResults((m) => ({ ...m, [id]: r }))

  const apply = async (item: StressItem, value: string): Promise<void> => {
    if (item.careful) {
      const ok = await ask(`${item.label}\n\n${item.desc}\n\nThay đổi này tác động lên cả điện thoại. Bạn có thể bấm “Khôi phục” bất cứ lúc nào để trả lại như cũ.`, { title: 'Thay đổi cả máy', ok: 'Áp dụng' })
      if (!ok) return
    }
    setBusy(item.id)
    try {
      finish(item.id, await window.api.stress.apply(serial, item.id, value, pkg))
    } catch (e) {
      finish(item.id, { ok: false, message: explain(e) })
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const restore = async (id?: string): Promise<void> => {
    setBusy(id ?? 'all')
    try {
      const r = await window.api.stress.restore(serial, id, pkg)
      if (id) finish(id, r)
      else setResults(r.ok ? {} : { all: r })
    } catch (e) {
      finish(id ?? 'all', { ok: false, message: explain(e) })
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const renderItem = (item: StressItem): React.ReactNode => {
    const on = applied.has(item.id)
    const needsApp = item.pkg && !pkg
    const tooOld = !!item.minSdk && !!status?.sdk && status.sdk < item.minSdk
    const off = !!busy || !!needsApp
    const value = choice[item.id] ?? item.choices?.[0]?.value ?? ''
    const r = results[item.id]
    return (
      <div key={item.id} className="sx-item">
        <div className="sx-text">
          <div className="sx-name">
            {item.label}
            {item.careful && (
              <span className="sx-warn" title="Tác động lên cả điện thoại">
                <TriangleAlert size={12} /> cả máy
              </span>
            )}
            {on && <span className="mini-tag bad">đang áp dụng: {applied.get(item.id)!.value}</span>}
          </div>
          <div className="sx-desc">{item.desc}</div>
          {needsApp && <div className="sx-need">Chọn app cần test ở phía trên để dùng mục này.</div>}
          {tooOld && <div className="sx-need">Cần Android {item.minSdk} trở lên (máy này API {status?.sdk}).</div>}
          {r && <div className={`sx-res ${r.ok ? 'ok' : 'bad'}`}>{r.message}</div>}
        </div>
        <div className="sx-ctl">
          {item.kind === 'action' && (
            <button className="iconbtn primary" disabled={off} onClick={() => void apply(item, '')}>
              {busy === item.id ? <Loader2 size={13} className="spin" /> : null} Chạy
            </button>
          )}
          {item.kind === 'toggle' && (
            <button className={`switch ${on ? 'on' : ''}`} disabled={off} role="switch" aria-checked={on} aria-label={item.label} onClick={() => void apply(item, on ? 'off' : 'on')}>
              <span />
            </button>
          )}
          {item.kind === 'choice' && (
            <>
              <select className="input sm" value={value} disabled={off || tooOld} aria-label={item.label} onChange={(e) => setChoice((c) => ({ ...c, [item.id]: e.target.value }))}>
                {item.choices!.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <button className="iconbtn primary" disabled={off || tooOld} onClick={() => void apply(item, value)}>
                {busy === item.id ? <Loader2 size={13} className="spin" /> : null} Áp dụng
              </button>
              {on && (
                <button className="iconbtn" disabled={!!busy} onClick={() => void restore(item.id)} title="Trả mục này về như cũ">
                  <Undo2 size={13} /> Bình thường
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  const count = status?.applied.length ?? 0
  return (
    <div className="panel wide sx-panel">
      <div className="log-tools">
        <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="App cần test (cho các mục theo app)…" style={{ width: 280 }} />
        {status && status.freeMb >= 0 && <span className="devchip" title="Dung lượng trống của phân vùng dữ liệu">Trống {status.freeMb >= 1024 ? `${(status.freeMb / 1024).toFixed(1)} GB` : `${status.freeMb} MB`}</span>}
        {status && status.sdk > 0 && <span className="devchip" title="Phiên bản Android của máy">Android API {status.sdk}</span>}
        <span className="spacer" style={{ flex: 1 }} />
        <button className={`iconbtn ${count ? 'danger-outline' : ''}`} disabled={!count || !!busy} onClick={() => void restore()} title="Trả mọi thay đổi ADB Kit đã làm về như ban đầu">
          {busy === 'all' ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />} Khôi phục tất cả{count ? ` (${count})` : ''}
        </button>
      </div>

      {count > 0 && (
        <div className="sx-applied">
          <b>Đang thay đổi trên máy:</b>
          {status!.applied.map((a) => (
            <span key={a.id} className="sx-chip">
              {label(a.id)} · {a.value}
              <button className="iconbtn ghost" aria-label={`Khôi phục ${label(a.id)}`} title="Khôi phục mục này" onClick={() => void restore(a.id)}>
                <Undo2 size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {results.all && <div className="log-meta bad">{results.all.message}</div>}

      <div className="panel-body sx-body">
        {GROUP_ORDER.map((g) => {
          const items = STRESS_ITEMS.filter((i) => i.group === g)
          return (
            <section key={g} className="mini-sec">
              <div className="mini-head">
                <b>{STRESS_GROUPS[g].title}</b>
              </div>
              <div className="sx-hint">{STRESS_GROUPS[g].hint}</div>
              {items.map(renderItem)}
            </section>
          )
        })}
      </div>
    </div>
  )
}
