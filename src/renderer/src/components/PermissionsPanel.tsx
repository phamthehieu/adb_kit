import { useCallback, useEffect, useState } from 'react'
import { Eraser, ExternalLink, ListPlus, Loader2, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react'
import { emptyScript, shortPerm, type FreshMode, type FreshPerms, type PermissionInfo, type Script, type Step } from '@shared/automation'
import { PackagePicker } from './PackagePicker'
import { ask } from '../lib/dialog'
import { permName } from '../lib/permLabels'

const KIND_TITLE: Record<PermissionInfo['kind'], { title: string; note: string }> = {
  runtime: { title: 'Quyền cần người dùng cho phép', note: 'Bật/tắt bằng pm grant / revoke. Thu hồi một quyền sẽ khiến Android tắt app.' },
  special: { title: 'Quyền đặc biệt', note: 'Cấp trong Cài đặt (hiển thị trên app khác, cài app, báo thức chính xác…), đổi bằng appops.' },
  install: { title: 'Quyền tự cấp khi cài đặt', note: 'Không thể bật/tắt. "?" = Android bản này không có quyền đó.' }
}

/** Append a step to the script stored for the "Tự động test" panel. */
function addToScript(step: Step): void {
  let s: Script
  try {
    s = { ...emptyScript(), ...JSON.parse(localStorage.getItem('autoScript') ?? '{}') }
  } catch {
    s = emptyScript()
  }
  s.steps = [...s.steps, step]
  localStorage.setItem('autoScript', JSON.stringify(s))
}

export function PermissionsPanel({ serial }: { serial: string }) {
  const [pkg, setPkg] = useState(() => localStorage.getItem('permPkg') ?? localStorage.getItem('netPkg') ?? '')
  const [perms, setPerms] = useState<PermissionInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!pkg) return
    try {
      setPerms(await window.api.perms.list(serial, pkg))
    } catch (e) {
      setPerms([])
      setMsg({ text: (e as Error).message, error: true })
    }
  }, [serial, pkg])

  useEffect(() => {
    if (!pkg) return
    localStorage.setItem('permPkg', pkg)
    setPerms(null)
    setMsg(null)
    void load()
  }, [pkg, load])

  const act = async (key: string, fn: () => Promise<{ ok: boolean; output: string }>, okText: string): Promise<void> => {
    setBusy(key)
    try {
      const r = await fn()
      setMsg(r.ok ? { text: okText } : { text: r.output || 'Thất bại', error: true })
      await load()
    } finally {
      setBusy(null)
    }
  }

  /** Same routine the test runs use before a run (works for any app). */
  const fresh = async (key: string, mode: FreshMode, perm: FreshPerms, question?: string): Promise<void> => {
    if (question && !(await ask(question, { danger: true, ok: 'Làm sạch app' }))) return
    setBusy(key)
    try {
      const r = await window.api.perms.fresh(serial, pkg, mode, perm)
      setMsg({ text: r.output.split('\n').join(' · ') || 'Xong', error: !r.ok })
      await load()
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (p: PermissionInfo): Promise<void> => {
    if (p.granted && !(await ask(`Thu hồi quyền ${shortPerm(p.name)} của ${pkg}?\n\nAndroid sẽ tắt app ngay lập tức.`, { danger: true, ok: 'Thu hồi' }))) return
    return act(p.name, () => window.api.perms.set(serial, pkg, p.name, !p.granted), `${p.granted ? 'Đã thu hồi' : 'Đã cấp'} ${shortPerm(p.name)}${p.granted ? ' — Android đã tắt app' : ''}`)
  }

  const setMode = (p: PermissionInfo, mode: string): Promise<void> =>
    act(p.name, () => window.api.perms.appop(serial, pkg, p.op!, mode), `${p.op} → ${mode}`)

  const addCheck = (p: PermissionInfo): void => {
    if (p.kind === 'special') addToScript({ type: 'appop', pkg, op: p.op!, mode: (p.mode as 'allow') ?? 'allow' })
    else addToScript({ type: 'permCheck', pkg, permission: p.name, expect: p.granted ? 'granted' : 'denied' })
    setMsg({ text: `Đã thêm bước cho ${shortPerm(p.name)} vào kịch bản (tab Tự động test)` })
  }

  const groups = (['runtime', 'special', 'install'] as const).map((k) => ({ k, list: (perms ?? []).filter((p) => p.kind === k) }))

  return (
    <div className="panel wide">
      <div className="log-tools">
        <PackagePicker serial={serial} value={pkg} onChange={setPkg} placeholder="Chọn app…" style={{ width: 260 }} />
        <button className="iconbtn" disabled={!pkg} onClick={() => void load()} title="Đọc lại"><RefreshCw size={13} /></button>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="iconbtn"
          disabled={!pkg || !!busy}
          onClick={() => void fresh('grant-all', 'off', 'all')}
          title="Cấp mọi quyền runtime còn thiếu (camera, vị trí, thông báo…) để hộp thoại hệ thống không chen vào lúc test"
        >
          <ShieldCheck size={13} /> Cấp hết
        </button>
        <button
          className="iconbtn danger"
          disabled={!pkg || !!busy}
          onClick={() =>
            void fresh(
              'fresh',
              'clear',
              'keep',
              `Xóa TOÀN BỘ dữ liệu của ${pkg} (đăng nhập, cài đặt, cache…) và tắt app?\nCác quyền đang cấp sẽ được cấp lại.`
            )
          }
          title="Xóa dữ liệu app như vừa cài mới, giữ nguyên các quyền đang cấp (pm clear)"
        >
          <Eraser size={13} /> Làm sạch app
        </button>
        <button
          className="iconbtn danger"
          disabled={!pkg || !!busy}
          onClick={async () => {
            if (await ask(`Thu hồi TẤT CẢ quyền runtime của ${pkg}?\n\nAndroid sẽ tắt app; lần mở sau app sẽ xin quyền lại.`, { danger: true, ok: 'Thu hồi tất cả' }))
              void act('all', () => window.api.perms.revokeAll(serial, pkg), 'Đã thu hồi tất cả quyền runtime')
          }}
          title="Đưa app về trạng thái như mới cài (để test luồng xin quyền)"
        >
          <ShieldOff size={13} /> Thu hồi tất cả
        </button>
        <button className="iconbtn" disabled={!pkg} onClick={() => void window.api.perms.openSettings(serial, pkg)} title="Mở trang cài đặt của app trên điện thoại">
          <ExternalLink size={13} /> Cài đặt app
        </button>
      </div>
      {msg && <div className={`log-meta ${msg.error ? 'bad' : ''}`}>{msg.text}</div>}

      <div className="panel-body perms">
        {!pkg && <div className="steps-empty">Chọn app để xem và bật/tắt quyền.</div>}
        {pkg && !perms && (
          <div className="steps-empty"><Loader2 size={16} className="spin" /></div>
        )}
        {groups.map(
          ({ k, list }) =>
            list.length > 0 && (
              <div key={k} className="perm-group">
                <div className="perm-head">
                  <span className="panel-title">{KIND_TITLE[k].title}</span>
                  <span className="muted">{KIND_TITLE[k].note}</span>
                </div>
                {list.map((p) => (
                  <div key={p.name} className="perm-row">
                    <span className="pn" title={p.name}>
                      {permName(p.name).vi ? (
                        <>
                          <span className="pn-vi">{permName(p.name).vi}</span>
                          <span className="pn-raw">{shortPerm(p.name)}</span>
                        </>
                      ) : (
                        <span className="pn-raw only">{shortPerm(p.name)}</span>
                      )}
                    </span>
                    <span className="pu">{p.lastUsed ? `dùng ${p.lastUsed}` : ''}</span>
                    {k === 'runtime' && (
                      <button
                        className={`switch ${p.granted ? 'on' : ''}`}
                        disabled={busy === p.name || /SYSTEM_FIXED|POLICY_FIXED/.test(p.flags ?? '')}
                        onClick={() => void toggle(p)}
                        title={p.flags ? `flags: ${p.flags}` : undefined}
                      >
                        <span />
                      </button>
                    )}
                    {k === 'special' && (
                      <select className="input sm" value={p.mode} disabled={busy === p.name} onChange={(e) => void setMode(p, e.target.value)}>
                        {['allow', 'ignore', 'deny', 'default'].map((m) => (
                          <option key={m} value={m}>{m === 'allow' ? 'cho phép' : m === 'ignore' ? 'chặn (ignore)' : m === 'deny' ? 'từ chối' : 'mặc định'}</option>
                        ))}
                      </select>
                    )}
                    {k === 'install' && <span className={`pstate ${p.granted ? 'ok' : ''}`}>{p.granted === null ? '?' : p.granted ? 'có' : 'không'}</span>}
                    {k !== 'install' && (
                      <button className="iconbtn ghost" title="Thêm bước kiểm tra trạng thái này vào kịch bản" onClick={() => addCheck(p)}>
                        <ListPlus size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    </div>
  )
}
