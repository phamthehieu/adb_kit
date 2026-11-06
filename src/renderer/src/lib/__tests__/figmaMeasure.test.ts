import { describe, expect, it } from 'vitest'
import { appAt, normText, toAppEls } from '../figmaMeasure'
import type { UiNode } from '@shared/automation'

describe('figmaMeasure utilities', () => {
  describe('normText', () => {
    it('normalizes accents, spaces, and case', () => {
      expect(normText('  Đăng  Nhập  ')).toBe('đăng nhập')
      expect(normText('TÀI   KHOẢN\n')).toBe('tài khoản')
    })
  })

  describe('toAppEls', () => {
    it('converts normalized nodes into pixel/dp elements according to screen density', () => {
      const nodes: UiNode[] = [
        {
          id: 'test_btn',
          cls: 'android.widget.Button',
          pkg: 'com.example',
          text: 'Tiếp tục',
          desc: '',
          b: [0, 0, 0.5, 0.1],
          clickable: true
        }
      ]
      // 1080x1920 with 320 dpi (density factor = 160 / 320 = 0.5)
      const res = toAppEls(nodes, 1080, 1920, 320)
      expect(res.w).toBe(540)
      expect(res.h).toBe(960)
      expect(res.els).toHaveLength(1)
      expect(res.els[0].w).toBe(270) // 0.5 * 1080 * 0.5 = 270
      expect(res.els[0].h).toBe(96) // 0.1 * 1920 * 0.5 = 96
    })
  })

  describe('appAt', () => {
    it('finds smallest element under dp coordinates', () => {
      const els = [
        { x: 0, y: 0, w: 300, h: 500, text: 'Container', desc: '', cls: 'ViewGroup' },
        { x: 20, y: 30, w: 100, h: 40, text: 'Button', desc: '', cls: 'Button' }
      ]
      const idx = appAt(els, 50, 45)
      expect(idx).toBe(1) // Smaller button should be chosen
    })

    it('returns -1 if tapping outside elements', () => {
      const els = [{ x: 10, y: 10, w: 50, h: 50, text: '', desc: '', cls: '' }]
      expect(appAt(els, 200, 200)).toBe(-1)
    })
  })
})
