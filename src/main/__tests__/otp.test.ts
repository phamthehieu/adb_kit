import { describe, expect, it } from 'vitest'
import { extractCode, parseNotifications } from '../otp'

describe('OTP parser utilities', () => {
  describe('extractCode', () => {
    it('extracts standard 6-digit OTP code', () => {
      const text = 'Ma OTP cua ban la 839201. Khong chia se ma nay voi bat ky ai.'
      expect(extractCode(text)).toBe('839201')
    })

    it('extracts code when preceded by Vietnamese keywords', () => {
      const text = 'Mã xác thực của bạn là: 492018, hiệu lực trong 2 phút.'
      expect(extractCode(text)).toBe('492018')
    })

    it('extracts code with G- prefix or English keywords', () => {
      const text = 'Your verification code is 123456. Do not share.'
      expect(extractCode(text)).toBe('123456')
    })

    it('penalizes 4-digit years in text like 2026', () => {
      const text = 'Chào mừng bạn năm 2026, mã đăng nhập của bạn là 715923.'
      expect(extractCode(text)).toBe('715923')
    })

    it('returns null if multiple numbers exist without any OTP keyword', () => {
      const text = 'So 1234 va 5678 goi luc trua.'
      expect(extractCode(text)).toBeNull()
    })
  })

  describe('parseNotifications', () => {
    it('parses dumpsys notification output into notes', () => {
      const dump = `
NotificationRecord(0x123 pkg=com.google.android.apps.messaging user=UserHandle{0} id=1 tag=null: Notification(channel=sms pri=0 ...))
  android.title=String (Viettel)
  android.text=String (Ma xac thuc OTP la 654321)
  android.subText=null
`
      const notes = parseNotifications(dump)
      expect(notes).toHaveLength(1)
      expect(notes[0].pkg).toBe('com.google.android.apps.messaging')
      expect(notes[0].title).toBe('Viettel')
      expect(notes[0].text).toContain('Ma xac thuc OTP la 654321')
    })
  })
})
