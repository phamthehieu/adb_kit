import { Action, keycode } from '@shared/control'

export * from '@shared/control'

/** Press and release a key on the mirrored device. */
export function sendKey(code: number): void {
  window.api.mirror.control(keycode(Action.Down, code))
  window.api.mirror.control(keycode(Action.Up, code))
}
