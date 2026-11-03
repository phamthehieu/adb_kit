export type DataKind = 'prefs' | 'db' | 'mmkv' | 'other'

export interface DataFile {
  /** Path relative to the app's data folder, e.g. shared_prefs/settings.xml */
  path: string
  kind: DataKind
  size: number
  /** Last modified (ms). */
  mtime: number
}

export interface PrefEntry {
  type: 'string' | 'int' | 'long' | 'float' | 'boolean' | 'set'
  name: string
  /** Value as text; for `set`, one item per line. */
  value: string
}

export interface DbTable {
  name: string
  rows: number
}

export interface DbResult {
  columns: string[]
  rows: (string | number | null)[][]
  /** Rows were cut to this many. */
  truncated: boolean
}

export interface MmkvEntry {
  key: string
  /** Best guess of the value (MMKV stores no types). */
  value: string
  /** How the bytes were read: text / số / bool / hex. */
  as: string
}
