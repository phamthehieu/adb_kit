/** Manual testing against an imported KBKT file, with evidence kept for every result. */
export type ManualResult = 'P' | 'F' | 'PE'

export const MANUAL_LABEL: Record<ManualResult, string> = { P: 'Đạt', F: 'Lỗi', PE: 'Xem xét' }

export interface EvidenceInput {
  /** KBKT file the test case comes from (names the folder the evidence goes into). */
  kbkt: string
  sheet: string
  row: number
  code: string
  purpose: string
  steps: string
  expected: string
  result: ManualResult
  note: string
  /** Also save the last lines of logcat (always for failures when true). */
  withLog: boolean
  /** Last seconds of the screen as WebM clips, oldest first (taken for failures only). */
  videos?: { data: Uint8Array; startedAt: number; endedAt: number }[]
}

export interface EvidenceResult {
  /** Folder holding everything for this result. */
  dir: string
  /** Summary page of the folder; this is what the KBKT cell links to. */
  html: string
  files: string[]
}
