import { describe, expect, it } from 'vitest'
import {
  callFailed,
  describeStep,
  findNode,
  matches,
  nodeAt,
  selectorFor,
  type NetCall,
  type UiNode
} from '../automation'

describe('automation shared utilities', () => {
  const sampleNodes: UiNode[] = [
    {
      id: 'com.example:id/container',
      cls: 'android.widget.FrameLayout',
      pkg: 'com.example',
      text: '',
      desc: '',
      b: [0, 0, 1, 1], // Full screen container (area = 1.0)
      clickable: false
    },
    {
      id: 'com.example:id/btn_login',
      cls: 'android.widget.Button',
      pkg: 'com.example',
      text: 'Đăng nhập',
      desc: 'Nút đăng nhập tài khoản',
      b: [0.1, 0.4, 0.9, 0.5], // area = 0.8 * 0.1 = 0.08
      clickable: true
    },
    {
      id: 'com.example:id/counter_badge',
      cls: 'android.widget.TextView',
      pkg: 'com.example',
      text: '5 Thông báo',
      desc: '',
      b: [0.7, 0.05, 0.9, 0.1], // area = 0.2 * 0.05 = 0.01
      clickable: true
    },
    {
      id: '',
      cls: 'android.widget.TextView',
      pkg: 'com.example',
      text: 'Quên mật khẩu?',
      desc: '',
      b: [0.2, 0.55, 0.8, 0.6],
      clickable: true
    }
  ]

  describe('nodeAt', () => {
    it('ignores full screen containers >= 0.5 area and selects smallest clickable node', () => {
      // Tap at [0.5, 0.45] inside btn_login
      const hit = nodeAt(sampleNodes, 0.5, 0.45)
      expect(hit).not.toBeNull()
      expect(hit?.id).toBe('com.example:id/btn_login')
    })

    it('returns null if tapping on empty space with only background container', () => {
      const hit = nodeAt(sampleNodes, 0.02, 0.02)
      expect(hit).toBeNull()
    })
  })

  describe('selectorFor', () => {
    it('creates selector with id and text', () => {
      const sel = selectorFor(sampleNodes[1])
      expect(sel).toBeDefined()
      expect(sel?.id).toBe('com.example:id/btn_login')
      expect(sel?.text).toBe('Đăng nhập')
    })

    it('strips counter badge and sets contains match mode', () => {
      const sel = selectorFor(sampleNodes[2])
      expect(sel).toBeDefined()
      expect(sel?.text).toBe('Thông báo')
      expect(sel?.match).toBe('contains')
    })
  })

  describe('matches & findNode', () => {
    it('matches exact text and id', () => {
      expect(matches(sampleNodes[1], { id: 'com.example:id/btn_login', text: 'Đăng nhập' })).toBe(true)
      expect(matches(sampleNodes[1], { id: 'wrong_id' })).toBe(false)
    })

    it('matches contains mode case-insensitively', () => {
      expect(matches(sampleNodes[1], { text: 'đăng', match: 'contains' })).toBe(true)
    })

    it('findNode picks exact text match first', () => {
      const node = findNode(sampleNodes, { text: 'Đăng nhập' })
      expect(node?.id).toBe('com.example:id/btn_login')
    })

    it('findNode resolves node nearest to point when ambiguous', () => {
      const node = findNode(sampleNodes, { match: 'contains', text: 'n' }, { x: 0.5, y: 0.45 })
      expect(node?.id).toBe('com.example:id/btn_login')
    })
  })

  describe('callFailed', () => {
    it('detects errors and bad status codes', () => {
      expect(callFailed({ startedAt: 0, error: 'TIMEOUT' } as NetCall)).toBe(true)
      expect(callFailed({ startedAt: 0, status: 500 } as NetCall)).toBe(true)
      expect(callFailed({ startedAt: 0, status: 404 } as NetCall)).toBe(true)
      expect(callFailed({ startedAt: 0, status: 0 } as NetCall)).toBe(true)
      expect(callFailed({ startedAt: 0, status: 200 } as NetCall)).toBe(false)
    })
  })

  describe('describeStep', () => {
    it('formats human readable descriptions for Vietnamese test reports', () => {
      expect(describeStep({ type: 'tap', x: 0.5, y: 0.5 })).toBe('Bấm tại 50%, 50%')
      expect(describeStep({ type: 'text', text: 'test password' })).toBe('Nhập "test password"')
      expect(describeStep({ type: 'wait', ms: 1000 })).toBe('Chờ 1000 ms')
      expect(describeStep({ type: 'launch', pkg: 'com.my.app', clear: true })).toBe(
        'Mở app com.my.app (xóa dữ liệu trước)'
      )
    })
  })
})
