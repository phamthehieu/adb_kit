/** "Thông báo": try how an app reacts when the user taps a notification, without a server or Firebase key. */

export interface PushExtra {
  key: string
  value: string
}

export type PushTap = 'none' | 'app' | 'link'

export interface PushInput {
  pkg: string
  title: string
  text: string
  /** `bigtext` shows the full text when the notification is expanded. */
  style: 'default' | 'bigtext'
  /** What tapping the notification does. */
  tap: PushTap
  link: string
  extras: PushExtra[]
}

export interface PushInfo {
  /** `package/Activity` the launcher opens, null if the app has no launcher screen. */
  launcher: string | null
  /** The app registers for Firebase Cloud Messaging. */
  fcm: boolean
  /** Android 13+: the notification permission state; null on older versions. */
  postPermission: 'granted' | 'denied' | null
  sdk: number
}

export interface PushResult {
  ok: boolean
  message: string
}
