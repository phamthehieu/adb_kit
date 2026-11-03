/** Quick device settings testers flip to check how an app copes (dark mode, big fonts…). */
export interface DevConfig {
  sdk: number
  /** Effective dark mode from the current configuration. */
  dark: boolean
  fontScale: number
  /** Effective density (dpi) and the value at the first change (to restore). */
  density: number
  baseDensity: number
  /** Animation scale (window / transition / animator), 0 = off. */
  animations: number
  layoutBounds: boolean
  showTouches: boolean
  /** Developer option "Force RTL layout direction". */
  rtl: boolean
  /** Settings changed by ADB Kit since the last restore: key → original value. */
  changed: string[]
}

export type ConfKey = 'dark' | 'fontScale' | 'density' | 'animations' | 'layoutBounds' | 'showTouches' | 'rtl'

export interface ConfResult {
  config: DevConfig
  /** Shown to the tester (e.g. "this device locks dark mode — opened Settings"). */
  note?: string
}

/* ------------------------------------------------------------ UI check (lint) */

export type IssueKind = 'target' | 'label' | 'overlap' | 'cut' | 'contrast' | 'edge'

export interface UiIssue {
  kind: IssueKind
  level: 'bad' | 'warn'
  /** Normalized bounds of the element. */
  b: [number, number, number, number]
  title: string
  detail: string
}
