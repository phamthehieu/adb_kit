/** Evidence captured the moment the tester presses "Báo lỗi" (before they type anything). */
export interface BugSnap {
  id: string
  /** App in the foreground at that moment. */
  pkg: string | null
  activity: string | null
  /** Screenshot PNG, for the preview in the dialog. */
  png: Uint8Array
  /** Recent API / bridge calls and JS errors known for that app (from the Mạng / API tab). */
  calls: number
  failedCalls: number
  errors: number
  crash: boolean
}

export type Severity = 'Nghiêm trọng' | 'Cao' | 'Trung bình' | 'Thấp'
export const SEVERITIES: Severity[] = ['Nghiêm trọng', 'Cao', 'Trung bình', 'Thấp']

export interface BugInput {
  title: string
  actual: string
  expected: string
  severity: Severity
  pkg: string
  /** Last seconds of the mirrored screen (WebM), oldest first. */
  videos: { data: Uint8Array; startedAt: number; endedAt: number }[]
  /** Manual actions before the report, oldest first. */
  trail: { at: number; text: string }[]
}

export interface BugResult {
  dir: string
  html: string
  zip: string
  /** Ready-to-paste description (Jira / Redmine / GitLab / Teams). */
  markdown: string
}
