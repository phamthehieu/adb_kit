import { flushSync } from 'react-dom'

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Run a state change that moves big parts of the layout (opening a panel shifts the phone) inside a
 * View Transition, so the browser morphs old → new instead of jumping. Falls back to a plain update
 * where View Transitions are missing or the user asked for reduced motion.
 */
export function withTransition(update: () => void): void {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!d.startViewTransition || reducedMotion()) return update()
  d.startViewTransition(() => flushSync(update))
}
