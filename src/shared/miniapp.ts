/** A debuggable page (tab) inside an app's WebView, as listed by DevTools' /json. */
export interface WebPage {
  id: string
  type: string
  title: string
  url: string
  /** Page is shown on screen (DevTools "attached" / not hidden). */
  visible?: boolean
}

/** One DevTools socket = one WebView-using process on the device. */
export interface WebViewProc {
  socket: string
  pid: number
  /** Package / process name owning the socket. */
  pkg: string
  /** Browser version reported by the WebView (e.g. Chrome/156.0…). */
  browser?: string
  pages: WebPage[]
  error?: string
}

/** A mini-app known to the super-app's container (read from the app's own data, debug builds). */
export interface MiniAppInfo {
  appId: string
  name: string
  version?: string
  type?: string
  icon?: string
  /** Numeric id used by the super-app's backend, if any. */
  miniAppId?: number
  firstCachedAt?: number
  updatedAt?: number
  /** Size of the downloaded bundle on the device, KB. */
  cacheKb?: number
}

/** How long a mini-app took to open (all ms, from the moment it was asked to open). */
export interface OpenTiming {
  ok: boolean
  error?: string
  url?: string
  title?: string
  at: number
  /** Measured after clearing the downloaded bundle and restarting the app ("first open"). */
  cold: boolean
  /** Tap → WebView page starts loading: container work, bundle download/unzip, WebView creation. */
  webviewMs?: number
  /** Tap → HTML received / DOM ready / first paint / main content / load / network quiet. */
  htmlMs?: number
  domMs?: number
  fcpMs?: number
  lcpMs?: number
  loadMs?: number
  idleMs?: number
  /** Page became visible (when paint metrics are unavailable). */
  shownMs?: number
  paintNote?: string
  resources?: number
  transferKb?: number
  slowest?: { name: string; ms: number }[]
}

export interface MiniAppList {
  /** Container recognised in the app (e.g. "Capacitor miniapp"), or null if none found. */
  container: string | null
  apps: MiniAppInfo[]
  /** Why the list is empty / partial (not debuggable, no container…). */
  note?: string
}
