/** A saved copy of an app's private data (login, settings, caches that matter), kept on this PC. */
export interface AppStateMeta {
  id: string
  pkg: string
  /** Name chosen by the tester, e.g. "Tài khoản A – đã đăng nhập". */
  name: string
  note: string
  createdAt: number
  /** Size of the archive in bytes. */
  size: number
  /** Number of files inside. */
  files: number
  /** App version the data was saved from (a different version may not accept it). */
  appVersion: string
  /** Phone the data was saved from. */
  device: string
}

export interface AppStateResult {
  ok: boolean
  /** What happened, in plain words. */
  message: string
  meta?: AppStateMeta
  /** Set when the state was saved from another app version than the one installed now. */
  versionWarning?: string
}

/** Folders of an app's data directory that hold the user's state (everything else is cache or code). */
export const STATE_DIRS = ['databases', 'files', 'shared_prefs', 'no_backup', 'datastore', 'app_*']

/**
 * Cache folders are left out of a saved state and left alone on restore: the app rebuilds them
 * (miniapp bundles, WebView caches). On one real app this took a state from 175 MB to 43 MB.
 */
export const STATE_EXCLUDES = ['*/cache/*', '*/Cache/*', '*/Code Cache/*', '*/GPUCache/*', '*/HTTP Cache/*', '*/DawnCache/*', '*/GrShaderCache/*', '*/ShaderCache/*', '*/Crashpad/*']
