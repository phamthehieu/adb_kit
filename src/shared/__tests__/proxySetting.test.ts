import { describe, expect, it } from 'vitest'
import { PROXY_RESET_COMMAND, normalizeProxySetting } from '../proxy'

describe('phone proxy setting', () => {
  it('treats a missing or cleared setting as "no proxy"', () => {
    expect(normalizeProxySetting('null\n')).toBe('')
    expect(normalizeProxySetting(':0\r\n')).toBe('')
    expect(normalizeProxySetting('')).toBe('')
  })

  it('keeps a real proxy exactly, to put it back later', () => {
    expect(normalizeProxySetting('10.0.0.5:8888\n')).toBe('10.0.0.5:8888')
    expect(normalizeProxySetting('proxy.corp.vn:3128')).toBe('proxy.corp.vn:3128')
    expect(normalizeProxySetting('[fe80::1]:8080')).toBe('[fe80::1]:8080')
  })

  it('never returns something that could be misread by the phone shell', () => {
    for (const bad of ['a:1; reboot', 'host:80 && rm -rf /sdcard', '$(id):80', 'host', 'host:port', '`x`:1'])
      expect(normalizeProxySetting(bad), bad).toBe('')
  })

  it('documents the manual way out', () => {
    expect(PROXY_RESET_COMMAND).toBe('adb shell settings put global http_proxy :0')
  })
})
