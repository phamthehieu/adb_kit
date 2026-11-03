// Binary control messages for scrcpy-server 5.x (see ControlMessageReader.java).
// All multi-byte values are big-endian.

export enum Msg {
  InjectKeycode = 0,
  InjectText = 1,
  InjectTouch = 2,
  InjectScroll = 3,
  BackOrScreenOn = 4,
  ExpandNotifications = 5,
  ExpandSettings = 6,
  CollapsePanels = 7,
  SetClipboard = 9,
  SetDisplayPower = 10,
  RotateDevice = 11,
  ResetVideo = 17
}

export enum Action {
  Down = 0,
  Up = 1,
  Move = 2
}

/** Android KeyEvent keycodes used by the UI. */
export const Key = {
  HOME: 3,
  BACK: 4,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  TAB: 61,
  ENTER: 66,
  DEL: 67,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  ESCAPE: 111,
  FORWARD_DEL: 112,
  MOVE_HOME: 122,
  MOVE_END: 123,
  APP_SWITCH: 187
} as const

const POINTER_ID_FINGER = -2n
const enc = new TextEncoder()

export function touch(action: Action, x: number, y: number, w: number, h: number): Uint8Array {
  const b = new DataView(new ArrayBuffer(32))
  b.setUint8(0, Msg.InjectTouch)
  b.setUint8(1, action)
  b.setBigInt64(2, POINTER_ID_FINGER)
  b.setInt32(10, Math.round(x))
  b.setInt32(14, Math.round(y))
  b.setUint16(18, w)
  b.setUint16(20, h)
  b.setUint16(22, action === Action.Up ? 0 : 0xffff) // pressure, u16 fixed point
  b.setInt32(24, 0) // action button
  b.setInt32(28, 0) // buttons
  return new Uint8Array(b.buffer)
}

/** hScroll / vScroll in "notches", range [-16, 16]. */
export function scroll(x: number, y: number, w: number, h: number, hScroll: number, vScroll: number): Uint8Array {
  const fx = (v: number): number => Math.max(-0x8000, Math.min(0x7fff, Math.round((v / 16) * 0x8000)))
  const b = new DataView(new ArrayBuffer(21))
  b.setUint8(0, Msg.InjectScroll)
  b.setInt32(1, Math.round(x))
  b.setInt32(5, Math.round(y))
  b.setUint16(9, w)
  b.setUint16(11, h)
  b.setInt16(13, fx(hScroll))
  b.setInt16(15, fx(vScroll))
  b.setInt32(17, 0)
  return new Uint8Array(b.buffer)
}

export function keycode(action: Action, code: number, metaState = 0): Uint8Array {
  const b = new DataView(new ArrayBuffer(14))
  b.setUint8(0, Msg.InjectKeycode)
  b.setUint8(1, action)
  b.setInt32(2, code)
  b.setInt32(6, 0) // repeat
  b.setInt32(10, metaState)
  return new Uint8Array(b.buffer)
}

export function text(s: string): Uint8Array {
  const t = enc.encode(s)
  const out = new Uint8Array(5 + t.length)
  const v = new DataView(out.buffer)
  v.setUint8(0, Msg.InjectText)
  v.setUint32(1, t.length)
  out.set(t, 5)
  return out
}

export function setClipboard(s: string, paste: boolean): Uint8Array {
  const t = enc.encode(s)
  const out = new Uint8Array(14 + t.length)
  const v = new DataView(out.buffer)
  v.setUint8(0, Msg.SetClipboard)
  v.setBigInt64(1, 0n) // sequence (0 = no ack wanted)
  v.setUint8(9, paste ? 1 : 0)
  v.setUint32(10, t.length)
  out.set(t, 14)
  return out
}

/** Turn the physical display on/off; mirroring and input keep working while it is off. */
export const displayPower = (on: boolean): Uint8Array => new Uint8Array([Msg.SetDisplayPower, on ? 1 : 0])

export const simple = (type: Msg): Uint8Array => new Uint8Array([type])
