import { describe, expect, it } from 'vitest'
import { DEVICE_PRESETS } from '../formfactors'

describe('Form factors and device presets', () => {
  it('contains essential categories: foldable, tablet, phone, cutout', () => {
    const categories = new Set(DEVICE_PRESETS.map((p) => p.category))
    expect(categories.has('foldable')).toBe(true)
    expect(categories.has('tablet')).toBe(true)
    expect(categories.has('phone')).toBe(true)
    expect(categories.has('cutout')).toBe(true)
  })

  it('Galaxy Z Fold Unfolded triggers tablet layout (sw600dp)', () => {
    const foldUnfolded = DEVICE_PRESETS.find((p) => p.id === 'zfold_unfolded')
    expect(foldUnfolded).toBeDefined()
    const dpWidth = Math.round((foldUnfolded!.width! * 160) / foldUnfolded!.density!)
    expect(dpWidth).toBeGreaterThanOrEqual(600) // Triggers Android sw600dp resource qualifier
  })

  it('Galaxy Z Fold Folded has narrow width (<400dp) for stress testing long text', () => {
    const foldFolded = DEVICE_PRESETS.find((p) => p.id === 'zfold_folded')
    expect(foldFolded).toBeDefined()
    const dpWidth = Math.round((foldFolded!.width! * 160) / foldFolded!.density!)
    expect(dpWidth).toBeLessThan(400) // Narrow cover screen
  })

  it('all cutout presets have valid AOSP overlay identifiers', () => {
    const cutouts = DEVICE_PRESETS.filter((p) => p.category === 'cutout')
    expect(cutouts.length).toBeGreaterThanOrEqual(4)
    for (const c of cutouts) {
      expect(c.cutout).toMatch(/^com\.android\.internal\.display\.cutout\.emulation\./)
    }
  })
})

