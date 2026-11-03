import { useEffect, useState } from 'react'
import { Check, ExternalLink, Loader2, Settings2, Ticket } from 'lucide-react'
import type { BugResult, Severity } from '@shared/bug'
import type { JiraCheck, JiraConf, JiraIssue, JiraState } from '@shared/jira'

const EMPTY: JiraConf = { url: '', email: '', project: '', issueType: 'Bug', usePriority: true }

/** "Create Jira ticket" for a saved bug report, with a one-time setup form. */
export function JiraBox({ result, title, severity }: { result: BugResult; title: string; severity: Severity }) {
  const [state, setState] = useState<JiraState | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<JiraConf>(EMPTY)
  const [token, setToken] = useState('')
  const [check, setCheck] = useState<JiraCheck | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | 'create' | null>(null)
  const [error, setError] = useState('')
  const [issue, setIssue] = useState<JiraIssue | null>(null)

  useEffect(() => {
    void window.api.jira.get().then((s) => {
      setState(s)
      if (s.conf) setForm(s.conf)
    })
  }, [])

  const ready = !!state?.conf && state.hasToken
  const upd = (p: Partial<JiraConf>): void => {
    setForm((f) => ({ ...f, ...p }))
    setCheck(null)
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    setError('')
    try {
      const c = await window.api.jira.test(form, token || undefined)
      setCheck(c)
      if (c.issueTypes.length && !c.issueTypes.includes(form.issueType)) upd({ issueType: c.issueTypes.find((t) => /bug|lỗi/i.test(t)) ?? c.issueTypes[0] })
      setCheck(c)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    setError('')
    try {
      const s = await window.api.jira.set(form, token || undefined)
      setState(s)
      setToken('')
      if (s.conf && s.hasToken) setEditing(false)
      else setError('Cần nhập token')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const create = async (): Promise<void> => {
    setBusy('create')
    setError('')
    try {
      setIssue(await window.api.jira.create({ summary: title, markdown: result.markdown, severity, dir: result.dir }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!state) return null

  if (issue) {
    return (
      <div className="jira-box">
        <div className="bug-ok">
          <Check size={15} /> Đã tạo ticket <b>{issue.key}</b> kèm ảnh màn hình và file zip.
          <button className="iconbtn" onClick={() => void window.api.openExternal(issue.url)}>
            <ExternalLink size={12} /> Mở trên Jira
          </button>
          <button className="iconbtn ghost" onClick={() => void navigator.clipboard.writeText(issue.url)}>Sao chép link</button>
        </div>
        {issue.warning && <div className="ck-note bad">{issue.warning}</div>}
      </div>
    )
  }

  if (!ready || editing) {
    return (
      <div className="jira-box">
        <div className="jira-head">
          <Ticket size={14} /> <b>Kết nối Jira</b>
          <span className="muted">một lần cho máy này — token được mã hóa và chỉ gửi tới Jira của bạn</span>
        </div>
        <div className="jira-form">
          <label>
            <span>Địa chỉ Jira</span>
            <input className="input" value={form.url} onChange={(e) => upd({ url: e.target.value })} placeholder="https://tenteam.atlassian.net" />
          </label>
          <label>
            <span>E-mail (Jira Cloud)</span>
            <input className="input" value={form.email} onChange={(e) => upd({ email: e.target.value })} placeholder="để trống nếu Jira Server dùng Personal Access Token" />
          </label>
          <label>
            <span>{form.email ? 'API token' : 'Personal Access Token'}</span>
            <input
              className="input"
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setCheck(null)
              }}
              placeholder={state.hasToken ? '•••••• (đã lưu — để trống nếu không đổi)' : form.email ? 'id.atlassian.com → Security → API tokens' : 'Jira → Hồ sơ → Personal Access Tokens'}
            />
          </label>
          <div className="bug-row">
            <label>
              <span>Mã dự án</span>
              <input className="input" value={form.project} onChange={(e) => upd({ project: e.target.value.toUpperCase() })} placeholder="vd. TAMMI" />
            </label>
            <label className="grow">
              <span>Loại ticket</span>
              {check?.issueTypes.length ? (
                <select className="input" value={form.issueType} onChange={(e) => upd({ issueType: e.target.value })}>
                  {check.issueTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <input className="input" value={form.issueType} onChange={(e) => upd({ issueType: e.target.value })} placeholder="Bug" />
              )}
            </label>
          </div>
          <label className="mini-check">
            <input type="checkbox" checked={form.usePriority} onChange={(e) => upd({ usePriority: e.target.checked })} /> Đặt Priority theo mức độ lỗi (Highest / High / Medium / Low)
          </label>
        </div>
        {check && (
          <div className="ck-note">
            ✓ Kết nối được: {check.user} · dự án “{check.projectName}”
          </div>
        )}
        {error && <div className="ck-note bad">{error}</div>}
        <div className="bug-actions">
          <span className="spacer" />
          {ready && <button className="iconbtn" onClick={() => setEditing(false)}>Hủy</button>}
          <button className="iconbtn" disabled={!!busy || !form.url || !form.project || (!token && !state.hasToken)} onClick={() => void test()}>
            {busy === 'test' ? <Loader2 size={12} className="spin" /> : null} Kiểm tra kết nối
          </button>
          <button className="iconbtn primary" disabled={!!busy || !form.url || !form.project || (!token && !state.hasToken)} onClick={() => void save()}>
            Lưu
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="jira-box">
      <div className="bug-actions">
        <button className="iconbtn primary" disabled={!!busy} onClick={() => void create()}>
          {busy === 'create' ? <Loader2 size={13} className="spin" /> : <Ticket size={13} />} Tạo ticket Jira ({state.conf!.project})
        </button>
        <span className="muted">kèm ảnh màn hình + file zip · {state.conf!.issueType}</span>
        <span className="spacer" />
        <button className="iconbtn ghost" onClick={() => setEditing(true)} title="Đổi cấu hình Jira">
          <Settings2 size={13} />
        </button>
      </div>
      {error && <div className="ck-note bad">{error}</div>}
    </div>
  )
}
