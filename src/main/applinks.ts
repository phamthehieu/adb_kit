import { q, shell } from './adb'

/**
 * Screens (activities) and deep links an app declares, read from `dumpsys package` (no APK
 * download, works for any installed app). Each intent filter with a VIEW action and data
 * (scheme / host / path) becomes one or more link templates the tester can open in one click.
 */

export interface AppLink {
  /** Example URL, e.g. tammi://miniapp or https://tammi.vn/s/… */
  url: string
  activity: string
  /** Browsable from a web page / other apps (android.intent.category.BROWSABLE). */
  browsable: boolean
  /** Verified App Link (autoVerify https). */
  autoVerify: boolean
  path?: string
}

export interface AppScreen {
  activity: string
  exported: boolean | null
  /** Launcher entry (MAIN + LAUNCHER). */
  launcher: boolean
  actions: string[]
}

interface Filter {
  activity: string
  actions: string[]
  categories: string[]
  schemes: string[]
  hosts: string[]
  paths: { kind: string; value: string }[]
  autoVerify: boolean
}

export async function appLinks(serial: string, pkg: string): Promise<{ links: AppLink[]; screens: AppScreen[] }> {
  const r = await shell(serial, `dumpsys package ${q(pkg)}`, 30_000)
  const text = r.stdout
  if (!text.includes(pkg)) throw new Error('Không tìm thấy app trên máy')
  // Only the activity resolver part (services / receivers use other tables).
  const start = text.indexOf('Activity Resolver Table:')
  const end = (() => {
    const cands = ['Receiver Resolver Table:', 'Service Resolver Table:', 'Provider Resolver Table:', 'Preferred Activities', 'Key Set Manager:', 'Packages:'].map((k) => text.indexOf(k, start + 1)).filter((i) => i > start)
    return cands.length ? Math.min(...cands) : text.length
  })()
  const table = start >= 0 ? text.slice(start, end) : ''
  const filters = new Map<string, Filter>()
  let cur: Filter | null = null
  const esc = pkg.replace(/\./g, '\\.')
  for (const raw of table.split('\n')) {
    const line = raw.trim()
    const head = new RegExp(`^[0-9a-f]+ ${esc}/(\\S+) filter ([0-9a-f]+)`).exec(line)
    if (head) {
      const key = head[2]
      cur = filters.get(key) ?? { activity: head[1], actions: [], categories: [], schemes: [], hosts: [], paths: [], autoVerify: false }
      filters.set(key, cur)
      continue
    }
    if (/^[0-9a-f]+ \S+\/\S+ filter/.test(line)) {
      cur = null // another app's filter in a shared table
      continue
    }
    if (!cur) continue
    const v = /"([^"]*)"/.exec(line)?.[1]
    if (line.startsWith('Action:') && v && !cur.actions.includes(v)) cur.actions.push(v)
    else if (line.startsWith('Category:') && v && !cur.categories.includes(v)) cur.categories.push(v)
    else if (line.startsWith('Scheme:') && v && !cur.schemes.includes(v)) cur.schemes.push(v)
    else if (line.startsWith('Authority:') && v && !cur.hosts.includes(v)) cur.hosts.push(v)
    else if (line.startsWith('Path:')) {
      const m = /PatternMatcher\{(\w+): ([^}]*)\}/.exec(line)
      if (m && !cur.paths.some((p) => p.value === m[2])) cur.paths.push({ kind: m[1], value: m[2] })
    } else if (/AutoVerify=true|autoVerify/i.test(line)) cur.autoVerify = true
  }

  const links: AppLink[] = []
  const seen = new Set<string>()
  for (const f of filters.values()) {
    if (!f.actions.includes('android.intent.action.VIEW') || !f.schemes.length) continue
    const browsable = f.categories.includes('android.intent.category.BROWSABLE')
    for (const s of f.schemes) {
      const hosts = f.hosts.length ? f.hosts : ['']
      for (const h of hosts) {
        const paths = f.paths.length ? f.paths : [{ kind: '', value: '' }]
        for (const p of paths) {
          // PREFIX / GLOB paths are templates: keep the fixed part and let the tester complete it.
          const path = p.value ? (p.kind === 'LITERAL' ? p.value : p.value.replace(/\.\*.*$|\*.*$/, '')) : ''
          const url = h ? `${s}://${h}${path}` : `${s}:${path}`
          if (seen.has(url + f.activity)) continue
          seen.add(url + f.activity)
          links.push({ url, activity: short(pkg, f.activity), browsable, autoVerify: f.autoVerify, path: p.kind && p.kind !== 'LITERAL' ? `${p.kind.toLowerCase()} ${p.value}` : undefined })
        }
      }
    }
  }

  // All activities of the package (exported flag where dumpsys shows it).
  const screens = new Map<string, AppScreen>()
  for (const f of filters.values()) {
    const a = short(pkg, f.activity)
    const s = screens.get(a) ?? { activity: a, exported: true, launcher: false, actions: [] }
    if (f.actions.includes('android.intent.action.MAIN') && f.categories.includes('android.intent.category.LAUNCHER')) s.launcher = true
    for (const x of f.actions) if (!s.actions.includes(x)) s.actions.push(x.replace('android.intent.action.', ''))
    screens.set(a, s)
  }
  const all = await shell(serial, `cmd package query-activities --components -a android.intent.action.MAIN ${q(pkg)} 2>/dev/null; pm dump ${q(pkg)} | grep -E '^\\s+[0-9a-f]+ ${esc}/' | head -400`)
  for (const m of all.stdout.matchAll(new RegExp(`${esc}/([\\w.$]+)`, 'g'))) {
    const a = short(pkg, m[1])
    if (!screens.has(a)) screens.set(a, { activity: a, exported: null, launcher: false, actions: [] })
  }
  return {
    links: links.sort((x, y) => Number(y.browsable) - Number(x.browsable) || x.url.localeCompare(y.url)),
    screens: [...screens.values()].sort((x, y) => Number(y.launcher) - Number(x.launcher) || x.activity.localeCompare(y.activity))
  }
}

const short = (pkg: string, a: string): string => (a.startsWith('.') ? pkg + a : a)

/** Open one activity directly (works for exported activities; others are refused by Android). */
export async function openActivity(serial: string, pkg: string, activity: string): Promise<string> {
  if (!/^[\w.$]+$/.test(activity)) throw new Error('Tên màn hình không hợp lệ')
  const r = await shell(serial, `am start -W -n ${q(`${pkg}/${activity}`)}`, 20_000)
  const out = (r.stdout + r.stderr).trim()
  if (/SecurityException|not exported|Permission Denial/i.test(out)) throw new Error('Màn hình này không mở trực tiếp được (không exported) — chỉ mở được từ trong app.')
  if (/Error/i.test(out)) throw new Error(out.split('\n').find((l) => /Error/.test(l)) ?? out)
  return out
}
