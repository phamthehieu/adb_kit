import { describe, expect, it } from 'vitest'
import { findNode } from '../automation'
import { centerDistance, isWebSelector, parseDisplay, parsePlacement, parseWebHits, webFindExpression, webHitsToNodes, type WebHits } from '../webFind'

const hits = (b: [number, number, number, number], text = 'Đăng nhập'): WebHits => ({
  vw: 360,
  vh: 640,
  focused: true,
  hits: [{ b, id: '', text, desc: '', clickable: true }]
})

describe('fast WebView lookup', () => {
  it('only takes selectors that can point at a web element', () => {
    expect(isWebSelector({ text: 'Đăng nhập' })).toBe(true)
    expect(isWebSelector({ id: 'login-btn' })).toBe(true)
    expect(isWebSelector({ desc: 'logo' })).toBe(true)
    expect(isWebSelector({ id: 'com.app:id/login' })).toBe(false) // Android resource id = native view
    expect(isWebSelector({ id: 'android:id/button1', text: 'OK' })).toBe(false)
    expect(isWebSelector({})).toBe(false)
  })

  it('builds a self-contained expression that carries the selector as JSON', () => {
    const e = webFindExpression({ text: 'It\'s "quoted" `tick` ${x} </script>', match: 'contains' })
    expect(() => new Function(`return ${e.replace(/\)\(\{[\s\S]*\}\)$/, ')')}`)).not.toThrow() // the function parses
    const arg = JSON.parse(/\)\((\{[\s\S]*\})\)$/.exec(e)![1])
    expect(arg).toEqual({ id: '', text: 'It\'s "quoted" `tick` ${x} </script>', desc: '', match: 'contains' })
  })

  it('reads the placement of the page that is on screen', () => {
    expect(parsePlacement('{"attached":true,"empty":false,"height":640,"screenX":0,"screenY":24,"visible":true,"width":360}')).toEqual({ x: 0, y: 24, w: 360, h: 640 })
    expect(parsePlacement('{"attached":true,"empty":false,"height":640,"screenX":0,"screenY":24,"visible":false,"width":360}')).toBeNull()
    expect(parsePlacement('{"attached":false,"empty":false,"height":640,"screenX":0,"screenY":24,"visible":true,"width":360}')).toBeNull()
    expect(parsePlacement('{"attached":true,"empty":true,"height":0,"screenX":0,"screenY":0,"visible":true,"width":0}')).toBeNull()
    expect(parsePlacement('')).toBeNull()
    expect(parsePlacement(undefined)).toBeNull()
    expect(parsePlacement('not json')).toBeNull()
  })

  it('reads the current screen size and the density in force', () => {
    expect(parseDisplay('  init=1440x2960 480dpi base=1440x2960 640dpi cur=1440x2960 app=1440x2816 rng=1440x1356-2816x2732')).toEqual({ w: 1440, h: 2960, density: 640 })
    expect(parseDisplay('    init=1080x2400 420dpi cur=2400x1080 app=2337x1080 rng=1080x1017-2400x2337')).toEqual({ w: 2400, h: 1080, density: 420 })
    expect(parseDisplay('nothing useful')).toBeNull()
  })

  it('rejects page answers of the wrong shape', () => {
    expect(parseWebHits(undefined)).toBeNull()
    expect(parseWebHits('{')).toBeNull()
    expect(parseWebHits('{"vw":0,"vh":640,"hits":[]}')).toBeNull()
    expect(parseWebHits('{"vw":360,"vh":640,"focused":true,"hits":[{"b":[1,2,3]},{"b":[1,2,3,4],"text":"a"}]}')?.hits).toHaveLength(1)
    expect(parseWebHits('{"vw":360,"vh":640,"hits":[]}')?.focused).toBe(false)
  })

  it('maps CSS px to screen fractions when the placement is in physical px', () => {
    // 1080x2400 screen, WebView below a 72 px status bar, 3 px per CSS px.
    const place = { x: 0, y: 72, w: 1080, h: 1920 }
    const [n] = webHitsToNodes(hits([100, 200, 220, 240]), place, { w: 1080, h: 2400, density: 480 }, 'px')
    expect(n.b[0]).toBeCloseTo(300 / 1080)
    expect(n.b[1]).toBeCloseTo((72 + 600) / 2400)
    expect(n.b[2]).toBeCloseTo(660 / 1080)
    expect(n.b[3]).toBeCloseTo((72 + 720) / 2400)
  })

  it('maps the same element to the same place when the placement is in dip', () => {
    const screen = { w: 1080, h: 2400, density: 480 }
    const px = webHitsToNodes(hits([100, 200, 220, 240]), { x: 0, y: 72, w: 1080, h: 1920 }, screen, 'px')[0]
    const dip = webHitsToNodes(hits([100, 200, 220, 240]), { x: 0, y: 24, w: 360, h: 640 }, screen, 'dip')[0]
    expect(centerDistance(px, dip)).toBeLessThan(1e-9)
    // …and the wrong reading of the same numbers is far enough to be told apart (calibration uses 3%).
    const wrong = webHitsToNodes(hits([100, 200, 220, 240]), { x: 0, y: 24, w: 360, h: 640 }, screen, 'px')[0]
    expect(centerDistance(px, wrong)).toBeGreaterThan(0.03)
  })

  it('scales by the viewport, so a zoomed-out ("wide viewport") page needs no special case', () => {
    const wide: WebHits = { vw: 980, vh: 1742, focused: true, hits: [{ b: [490, 871, 490, 871], id: '', text: 'x', desc: '', clickable: false }] }
    const [n] = webHitsToNodes(wide, { x: 0, y: 0, w: 1080, h: 1920 }, { w: 1080, h: 1920, density: 480 }, 'px')
    expect(n.b[0]).toBeCloseTo(0.5)
    expect(n.b[1]).toBeCloseTo(0.5)
  })

  it('keeps bounds inside the screen and produces nodes findNode can rank', () => {
    const many: WebHits = {
      vw: 360,
      vh: 640,
      focused: true,
      hits: [
        { b: [0, 300, 300, 340], id: '', text: 'Hãy bấm Đăng nhập để tiếp tục sử dụng ứng dụng', desc: '', clickable: false },
        { b: [100, 200, 220, 240], id: 'login', text: 'Đăng nhập', desc: '', clickable: true },
        { b: [-50, -50, 400, 700], id: '', text: 'Đăng nhập tràn', desc: '', clickable: false }
      ]
    }
    const nodes = webHitsToNodes(many, { x: 0, y: 0, w: 360, h: 640 }, { w: 360, h: 640, density: 160 }, 'px')
    for (const n of nodes) for (const v of n.b) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1)
    expect(findNode(nodes, { text: 'đăng nhập', match: 'contains' })?.id).toBe('login')
  })
})
