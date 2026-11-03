import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { JiraCheck, JiraConf, JiraIssue, JiraState } from '../shared/jira'
import type { Severity } from '../shared/bug'

/**
 * Create Jira tickets straight from a quick bug report (REST API v2: works on Jira Cloud and
 * Server / Data Center). The API token is encrypted with the OS (DPAPI) and never leaves this
 * PC except in the Authorization header sent to the configured Jira site.
 */
const confFile = (): string => join(app.getPath('userData'), 'jira.json')
const tokenFile = (): string => join(app.getPath('userData'), 'jira-token.bin')

function readConf(): JiraConf | null {
  try {
    return existsSync(confFile()) ? (JSON.parse(readFileSync(confFile(), 'utf8')) as JiraConf) : null
  } catch {
    return null
  }
}

function readToken(): string | null {
  try {
    if (!existsSync(tokenFile())) return null
    const buf = readFileSync(tokenFile())
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null
  } catch {
    return null
  }
}

export function getJira(): JiraState {
  return { conf: readConf(), hasToken: !!readToken() }
}

/** https only (http allowed for a local test server). Returns the normalized base URL. */
function siteUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('Địa chỉ Jira không hợp lệ (vd. https://tenteam.atlassian.net)')
  }
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname)
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('Địa chỉ Jira phải bắt đầu bằng https://')
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

export function setJira(conf: JiraConf, token?: string): JiraState {
  const clean: JiraConf = {
    url: siteUrl(conf.url),
    email: conf.email.trim(),
    project: conf.project.trim().toUpperCase(),
    issueType: conf.issueType.trim() || 'Bug',
    usePriority: conf.usePriority
  }
  writeFileSync(confFile(), JSON.stringify(clean, null, 1))
  if (token && token.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Máy này không mã hóa được token (safeStorage) — không lưu token')
    writeFileSync(tokenFile(), safeStorage.encryptString(token.trim()))
  }
  return getJira()
}

function authHeader(conf: JiraConf, token: string): string {
  // Cloud: Basic e-mail:API-token. Server / DC: Bearer personal access token.
  return conf.email ? `Basic ${Buffer.from(`${conf.email}:${token}`).toString('base64')}` : `Bearer ${token}`
}

async function call<T>(conf: JiraConf, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${conf.url}${path}`, {
    ...init,
    headers: { Accept: 'application/json', Authorization: authHeader(conf, token), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000)
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text.slice(0, 300)
    try {
      const j = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string> }
      msg = [...(j.errorMessages ?? []), ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`)].join('; ') || msg
    } catch {
      /* not JSON (HTML login page…) */
    }
    const hint =
      res.status === 401 ? ' — sai e-mail / token' : res.status === 403 ? ' — tài khoản không có quyền' : res.status === 404 ? ' — sai địa chỉ hoặc mã dự án' : ''
    const err = new Error(`Jira báo lỗi ${res.status}${hint}${msg ? `: ${msg}` : ''}`) as Error & { status?: number; body?: string }
    err.status = res.status
    err.body = text
    throw err
  }
  return (text ? JSON.parse(text) : {}) as T
}

function need(): { conf: JiraConf; token: string } {
  const conf = readConf()
  const token = readToken()
  if (!conf || !token) throw new Error('Chưa cấu hình Jira')
  return { conf, token }
}

/** Check the connection: who we are, the project, and its issue types. */
export async function testJira(conf?: JiraConf, token?: string): Promise<JiraCheck> {
  const c = conf ? { ...conf, url: siteUrl(conf.url), project: conf.project.trim().toUpperCase() } : need().conf
  const t = token?.trim() || readToken()
  if (!t) throw new Error('Chưa nhập token')
  const me = await call<{ displayName?: string; name?: string; emailAddress?: string }>(c, t, '/rest/api/2/myself')
  const proj = await call<{ name: string; issueTypes?: { name: string; subtask?: boolean }[] }>(c, t, `/rest/api/2/project/${encodeURIComponent(c.project)}`)
  return {
    user: me.displayName || me.name || me.emailAddress || '?',
    projectName: proj.name,
    issueTypes: (proj.issueTypes ?? []).filter((x) => !x.subtask).map((x) => x.name)
  }
}

const PRIORITY: Record<Severity, string> = { 'Nghiêm trọng': 'Highest', Cao: 'High', 'Trung bình': 'Medium', Thấp: 'Low' }

/** Our Markdown (bold, lists, italics, code) → Jira wiki markup used by REST API v2. */
export function mdToWiki(md: string): string {
  return md
    .split('\n')
    .map((line) =>
      line
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/^- /, '* ')
        .replace(/^\d+\. /, '# ')
        .replace(/`([^`]+)`/g, '{{$1}}')
    )
    .join('\n')
}

export async function createJiraIssue(input: { summary: string; markdown: string; severity: Severity; files: string[] }): Promise<JiraIssue> {
  const { conf, token } = need()
  const shot = input.files.find((f) => /\.png$/i.test(f))
  // The description's first line repeats the title (bold) — Jira shows the summary already.
  const body = input.markdown.split('\n').slice(input.markdown.startsWith('**') ? 2 : 0).join('\n')
  const description = `${mdToWiki(body)}${shot ? `\n\n!${basename(shot)}|thumbnail!` : ''}\n\n_Tạo bằng ADB Kit_`
  const fields: Record<string, unknown> = {
    project: { key: conf.project },
    summary: input.summary.slice(0, 250) || 'Lỗi chưa đặt tên',
    description,
    issuetype: { name: conf.issueType }
  }
  if (conf.usePriority) fields.priority = { name: PRIORITY[input.severity] }
  let created: { key: string }
  try {
    created = await call<{ key: string }>(conf, token, '/rest/api/2/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) })
  } catch (e) {
    // Many projects don't put Priority on the create screen: retry without it.
    const err = e as Error & { status?: number; body?: string }
    if (err.status === 400 && fields.priority && /priority/i.test(err.body ?? '')) {
      delete fields.priority
      created = await call<{ key: string }>(conf, token, '/rest/api/2/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) })
    } else throw e
  }
  const failed: string[] = []
  for (const f of input.files) {
    try {
      const size = statSync(f).size
      if (size > 50 * 1024 * 1024) throw new Error('quá 50 MB')
      const form = new FormData()
      form.append('file', new Blob([readFileSync(f)]), basename(f))
      await call(conf, token, `/rest/api/2/issue/${created.key}/attachments`, { method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, body: form })
    } catch (e) {
      failed.push(`${basename(f)} (${(e as Error).message})`)
    }
  }
  return {
    key: created.key,
    url: `${conf.url}/browse/${created.key}`,
    warning: failed.length ? `Đã tạo ticket nhưng không đính kèm được: ${failed.join(', ')}` : undefined
  }
}
