import { useSyncExternalStore } from 'react'
import type { Step, UiNode } from '@shared/automation'

/**
 * Tiny shared store between the screen (where gestures happen) and the automation
 * panel (which owns the script). Recorded steps carry normalized coordinates.
 */
interface State {
  recording: boolean
  inspecting: boolean
  /** Normalized bounds to outline on the screen (inspector / running step). */
  highlight: UiNode['b'] | null
  /** A test / suite is running: manual input on the mirrored screen is locked. */
  running: boolean
  /** Tester chose to allow manual input during a run anyway. */
  unlocked: boolean
  /** Drawing ignore-regions for a visual step on the mirrored screen. */
  maskEdit: { index: number; masks: Mask[] } | null
}

export type Mask = [number, number, number, number]

let state: State = { recording: false, inspecting: false, highlight: null, running: false, unlocked: false, maskEdit: null }

const maskListeners = new Set<(index: number, masks: Mask[] | null) => void>()
/** Called by the screen when the tester finishes (masks) or cancels (null) drawing. */
export function finishMasks(masks: Mask[] | null): void {
  const m = state.maskEdit
  autoStore.set({ maskEdit: null })
  if (m) maskListeners.forEach((l) => l(m.index, masks))
}
export function onMasksDone(l: (index: number, masks: Mask[] | null) => void): () => void {
  maskListeners.add(l)
  return () => maskListeners.delete(l)
}
const listeners = new Set<() => void>()
const recordListeners = new Set<(s: Step) => void>()
const inspectListeners = new Set<(x: number, y: number) => void>()

export const autoStore = {
  get: (): State => state,
  set(patch: Partial<State>): void {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  }
}

export function useAutoState(): State {
  return useSyncExternalStore(autoStore.subscribe, autoStore.get)
}

/** Called by the screen for every user action; ignored unless recording. */
export function record(step: Step): void {
  pushTrail(step)
  if (state.recording) recordListeners.forEach((l) => l(step))
}

/* ---------- action trail (for quick bug reports: "what did the tester just do") */

export interface TrailItem {
  at: number
  step: Step
}
const trail: TrailItem[] = []

function pushTrail(step: Step): void {
  const last = trail[trail.length - 1]
  // Typing arrives one character at a time: merge it into one "type text" action.
  if (step.type === 'text' && last?.step.type === 'text' && Date.now() - last.at < 4000) {
    last.step = { ...last.step, text: last.step.text + step.text }
    last.at = Date.now()
    return
  }
  trail.push({ at: Date.now(), step })
  if (trail.length > 60) trail.splice(0, trail.length - 60)
}

/** Manual actions on the mirror within the last `ms` milliseconds, oldest first. */
export function recentTrail(ms = 3 * 60_000): TrailItem[] {
  const since = Date.now() - ms
  return trail.filter((t) => t.at >= since)
}
export function onRecord(l: (s: Step) => void): () => void {
  recordListeners.add(l)
  return () => recordListeners.delete(l)
}

const actionListeners = new Set<() => void>()

/** Any input that may change the device screen (tap/swipe end, scroll, key, text). */
export function emitAction(): void {
  actionListeners.forEach((l) => l())
}
export function onAction(l: () => void): () => void {
  actionListeners.add(l)
  return () => actionListeners.delete(l)
}

/** Called by the screen when the user clicks in inspector mode (normalized point). */
export function inspectAt(x: number, y: number): void {
  inspectListeners.forEach((l) => l(x, y))
}
export function onInspect(l: (x: number, y: number) => void): () => void {
  inspectListeners.add(l)
  return () => inspectListeners.delete(l)
}
