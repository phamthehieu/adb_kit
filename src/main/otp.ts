import { shell } from './adb'

/**
 * One-time codes from the phone's notifications (SMS apps, authenticator / bank apps…).
 * Reads `dumpsys notification --noredact` on the device the tester controls, extracts only the
 * code and the sender, and never stores message text. Notifications that already existed when
 * watching started are ignored, so an old code is never typed by mistake.
 */

export interface OtpHit {
  code: string
  /** App that posted the notification and its title (sender). */
  pkg: string
  title: string
  /** When ADB Kit first saw it (PC clock). */
  seenAt: number
}

interface Note {
  key: string
  pkg: string
  title: string
  text: string
}

/** Split the dump into notification records with their title / text extras. */
export function parseNotifications(dump: string): Note[] {
  const out: Note[] = []
  const parts = dump.split(/\n\s*NotificationRecord\(/).slice(1)
  for (const p of parts) {
    const pkg = /pkg=([\w.]+)/.exec(p)?.[1] ?? ''
    const key = /key=([^:\s]+(?::[^\s)]*)?)/.exec(p)?.[1] ?? `${pkg}|${out.length}`
    const extra = (name: string): string => {
      const m = new RegExp(`android\\.${name}=\\w+ \\(([\\s\\S]*?)\\)\\s*\\n`).exec(p)
      return m ? m[1] : ''
    }
    const title = extra('title')
    const text = [extra('text'), extra('bigText'), extra('subText')].filter(Boolean).join(' ')
    if (title || text) out.push({ key, pkg, title, text })
  }
  return out
}

const KEYWORDS = /otp|m[ãa]\s*(x[áa]c\s*(th[ựu]c|nh[ậa]n)|k[íi]ch\s*ho[ạa]t|b[ảa]o\s*m[ậa]t|đăng\s*nh[ậa]p|dang\s*nhap)?|code|verif|x[áa]c\s*th[ựu]c|x[áa]c\s*minh|passcode|one[-\s]?time|m[ậa]t\s*kh[ẩa]u\s*m[ộo]t\s*l[ầa]n|pin/i

/** Best one-time code in a text: 4–8 digits, preferring ones next to an OTP keyword. */
export function extractCode(text: string): string | null {
  // "G-123456" style prefixes are fine; digits glued to other digits / separators are not.
  const found = [...text.matchAll(/(?<![\d.,:/]|\d-)(\d{4,8})(?![\d.,:/-]?\d)/g)].map((m) => ({ code: m[1], at: m.index ?? 0 }))
  if (!found.length) return null
  const kw = [...text.matchAll(new RegExp(KEYWORDS, 'gi'))].map((m) => m.index ?? 0)
  const score = (f: { code: string; at: number }): number => {
    let s = 0
    if (kw.length) s += 100 - Math.min(100, Math.min(...kw.map((k) => Math.abs(k - f.at))) / 2)
    if (f.code.length === 6) s += 20 // the most common OTP length
    if (/^(19|20)\d\d$/.test(f.code)) s -= 40 // looks like a year
    return s
  }
  // Without any OTP word, only trust a lone 4–8 digit number.
  if (!kw.length && found.length > 1) return null
  return found.sort((a, b) => score(b) - score(a))[0].code
}

/** Watches notifications from now on and reports new codes. */
export class OtpWatcher {
  private seen = new Map<string, string>() // key → text already known
  private ready: Promise<void>

  constructor(private readonly serial: string) {
    this.ready = this.read().then((list) => {
      for (const n of list) this.seen.set(n.key, n.text + n.title)
    })
  }

  private async read(): Promise<Note[]> {
    const r = await shell(this.serial, 'dumpsys notification --noredact', 15_000)
    return parseNotifications(r.stdout)
  }

  /** New codes since the watcher started (or since the last poll). */
  async poll(): Promise<OtpHit[]> {
    await this.ready
    const hits: OtpHit[] = []
    for (const n of await this.read()) {
      const sig = n.text + n.title
      if (this.seen.get(n.key) === sig) continue
      this.seen.set(n.key, sig)
      const code = extractCode(`${n.title} ${n.text}`)
      if (code) hits.push({ code, pkg: n.pkg, title: n.title.slice(0, 60), seenAt: Date.now() })
    }
    return hits
  }

  /** Wait for the next new code (throws after timeoutMs). */
  async next(timeoutMs: number, every = 1500): Promise<OtpHit> {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      const h = await this.poll()
      if (h.length) return h[h.length - 1]
      await new Promise((r) => setTimeout(r, every))
    }
    throw new Error(`không nhận được mã OTP nào trong ${Math.round(timeoutMs / 1000)} giây`)
  }
}
