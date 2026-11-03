import { net, session } from 'electron'
import { shell } from './adb'

/** OpenStreetMap services ask apps to identify themselves. */
const OSM_UA = 'ADB-Kit/0.1 (desktop QA tool for Android; mock GPS map)'

/** Map tiles are loaded by the renderer: give those requests an identifying User-Agent. */
export function setupMapRequests(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://tile.openstreetmap.org/*', 'https://*.tile.openstreetmap.fr/*'] }, (d, cb) => {
    cb({ requestHeaders: { ...d.requestHeaders, 'User-Agent': OSM_UA } })
  })
}

/**
 * Fake GPS for testing location features (Android 12+): registers shell test providers for
 * gps / network / fused and feeds them a position — fixed, or moving along a straight route.
 * Uses only built-in `cmd location` commands (no helper app). Apps see a "mock" location.
 */

const PROVIDERS = ['gps', 'network', 'fused']
const active = new Map<string, { timer: NodeJS.Timeout | null; providers: string[] }>()

async function sdk(serial: string): Promise<number> {
  return Number((await shell(serial, 'getprop ro.build.version.sdk')).stdout.trim()) || 0
}

async function ensure(serial: string): Promise<string[]> {
  const have = active.get(serial)
  if (have) return have.providers
  if ((await sdk(serial)) < 31) throw new Error('Giả lập GPS qua adb cần Android 12 trở lên. Máy cũ hơn: dùng app "Fake GPS" và chọn nó trong Tùy chọn nhà phát triển › Ứng dụng vị trí mô phỏng.')
  await shell(serial, 'appops set com.android.shell android:mock_location allow')
  const ok: string[] = []
  for (const p of PROVIDERS) {
    const r = await shell(serial, `cmd location providers add-test-provider ${p}; cmd location providers set-test-provider-enabled ${p} true`)
    if (!/exception|error|unknown/i.test(r.stdout + r.stderr)) ok.push(p)
  }
  if (!ok.length) throw new Error('Máy không cho tạo nguồn vị trí thử nghiệm (cmd location)')
  active.set(serial, { timer: null, providers: ok })
  return ok
}

async function push(serial: string, providers: string[], lat: number, lng: number): Promise<void> {
  const loc = `${lat.toFixed(6)},${lng.toFixed(6)}`
  await shell(serial, providers.map((p) => `cmd location providers set-test-provider-location ${p} --location ${loc} --accuracy 5`).join('; '))
}

const check = (lat: number, lng: number): void => {
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new Error('Tọa độ không hợp lệ (vĩ độ -90..90, kinh độ -180..180)')
}

/** Put the phone at one place. */
export async function setLocation(serial: string, lat: number, lng: number): Promise<void> {
  check(lat, lng)
  const providers = await ensure(serial)
  const a = active.get(serial)!
  if (a.timer) clearInterval(a.timer)
  a.timer = null
  await push(serial, providers, lat, lng)
  // Some apps only take a fix that keeps updating: repeat it every 2 s.
  a.timer = setInterval(() => void push(serial, providers, lat, lng).catch(() => {}), 2000)
}

/** Move in a straight line from A to B in `seconds`, one update per second, then stay at B. */
export async function moveRoute(serial: string, from: [number, number], to: [number, number], seconds: number): Promise<void> {
  check(...from)
  check(...to)
  const providers = await ensure(serial)
  const a = active.get(serial)!
  if (a.timer) clearInterval(a.timer)
  const steps = Math.max(1, Math.round(seconds))
  let i = 0
  await push(serial, providers, ...from)
  a.timer = setInterval(() => {
    i = Math.min(steps, i + 1)
    const f = i / steps
    void push(serial, providers, from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f).catch(() => {})
  }, 1000)
}

/** Remove the test providers: the phone goes back to its real location. */
export async function clearLocation(serial: string): Promise<void> {
  const a = active.get(serial)
  if (a?.timer) clearInterval(a.timer)
  active.delete(serial)
  await shell(serial, PROVIDERS.map((p) => `cmd location providers remove-test-provider ${p} 2>/dev/null`).join('; ') + '; appops set com.android.shell android:mock_location default')
}

export const gpsActive = (serial: string): boolean => active.has(serial)

export interface Place {
  name: string
  lat: number
  lng: number
}

let lastSearch = 0

// Electron's net uses the system network stack and proxy settings (like the map tiles).
const getJson = async <T>(url: string): Promise<T> => {
  const res = await net.fetch(url, { headers: { 'User-Agent': OSM_UA }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Photon (komoot, OpenStreetMap data): results biased towards the area being viewed. */
async function photon(q: string, near?: [number, number]): Promise<Place[]> {
  type F = { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }
  // Mild bias: nearby first, but well-known places elsewhere (Bến Thành from Hà Nội) still win.
  const bias = near ? `&lat=${near[0]}&lon=${near[1]}&zoom=9&location_bias_scale=0.6` : ''
  const r = await getJson<{ features: F[] }>(`https://photon.komoot.io/api/?limit=6&q=${encodeURIComponent(q)}${bias}`)
  return r.features.map((f) => {
    const p = f.properties
    const street = [p.housenumber, p.street].filter(Boolean).join(' ')
    const name = [p.name, street, p.district, p.city, p.state, p.country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')
    return { name, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
  })
}

/** Nominatim (OpenStreetMap): max one request per second, identifying User-Agent. */
async function nominatim(q: string): Promise<Place[]> {
  const wait = 1100 - (Date.now() - lastSearch)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastSearch = Date.now()
  const list = await getJson<{ display_name: string; lat: string; lon: string }[]>(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=vi&q=${encodeURIComponent(q)}`
  )
  return list.map((p) => ({ name: p.display_name, lat: Number(p.lat), lng: Number(p.lon) }))
}

/** Address search (only when the tester types a query): Photon, falling back to Nominatim. */
export async function searchPlace(query: string, near?: [number, number]): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    return await photon(q, near)
  } catch (e1) {
    try {
      return await nominatim(q)
    } catch {
      throw new Error(`Không tìm được địa chỉ (mạng chặn dịch vụ tìm kiếm?): ${(e1 as Error).message}`)
    }
  }
}

export async function clearAllLocations(): Promise<void> {
  for (const s of [...active.keys()]) await clearLocation(s).catch(() => {})
}
