import { describe, expect, it } from 'vitest'
import { parseUiXml } from '../ui'

const node = (attrs: string, children = ''): string => (children ? `<node ${attrs}>${children}</node>` : `<node ${attrs} />`)
const xml = (body: string): string => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${body}</hierarchy>`

describe('parseUiXml (uiautomator dump)', () => {
  it('normalizes bounds by the real screen size, not by the largest node', () => {
    // The navigation bar is missing from the tree: the largest node is shorter than the screen.
    const out = xml(node('class="android.widget.FrameLayout" bounds="[0,0][1080,2000]"', node('text="OK" clickable="true" bounds="[540,1000][1080,2000]"')))
    const r = parseUiXml(out, [1080, 2220])
    expect([r.width, r.height]).toEqual([1080, 2220])
    expect(r.nodes[1].b).toEqual([0.5, 1000 / 2220, 1, 2000 / 2220])
    expect(r.nodes[1].clickable).toBe(true)
  })

  it('falls back to the largest node when the screen size is unknown', () => {
    const r = parseUiXml(xml(node('bounds="[0,0][720,1280]"')), null)
    expect([r.width, r.height]).toEqual([720, 1280])
    expect(r.nodes[0].b).toEqual([0, 0, 1, 1])
  })

  it('drops nodes with empty bounds and re-parents their children to the nearest kept node', () => {
    const out = xml(
      node(
        'resource-id="root" bounds="[0,0][1000,2000]"',
        node('resource-id="offscreen" bounds="[0,0][0,0]"', node('resource-id="child" bounds="[0,0][500,500]"')) + node('resource-id="sibling" bounds="[0,500][500,1000]"')
      )
    )
    const r = parseUiXml(out, [1000, 2000])
    expect(r.nodes.map((n) => n.id)).toEqual(['root', 'child', 'sibling'])
    expect(r.nodes.map((n) => n.parent)).toEqual([-1, 0, 0])
  })

  it('keeps sibling nesting right after self-closing and closed nodes', () => {
    const out = xml(
      node('resource-id="a" bounds="[0,0][100,100]"', node('resource-id="a1" bounds="[0,0][50,50]"')) +
        node('resource-id="b" bounds="[0,0][100,100]"', node('resource-id="b1" bounds="[0,0][50,50]"'))
    )
    const r = parseUiXml(out, null)
    expect(r.nodes.map((n) => [n.id, n.parent])).toEqual([
      ['a', -1],
      ['a1', 0],
      ['b', -1],
      ['b1', 2]
    ])
  })

  it('reads id, text, description, short class name, package and enabled state', () => {
    const out = xml(
      node('resource-id="com.app:id/login" text="Đăng nhập" content-desc="nút đăng nhập" class="android.widget.Button" package="com.app" enabled="false" bounds="[0,0][10,10]"')
    )
    const n = parseUiXml(out, null).nodes[0]
    expect(n).toMatchObject({ id: 'com.app:id/login', text: 'Đăng nhập', desc: 'nút đăng nhập', cls: 'Button', pkg: 'com.app', enabled: false, clickable: false })
  })

  it('unescapes XML entities exactly once', () => {
    const out = xml(node('text="A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos; &#10;f &#x1F600; &amp;lt;" bounds="[0,0][10,10]"'))
    expect(parseUiXml(out, null).nodes[0].text).toBe('A & B <c> "d" \'e\' \nf \u{1F600} &lt;')
  })

  it('ignores whatever uiautomator prints after the XML', () => {
    const out = xml(node('bounds="[0,0][10,10]"')) + 'UI hierchary dumped to: /dev/tty\n'
    expect(parseUiXml(out, null).nodes).toHaveLength(1)
  })

  it('reports the tool message when there is no hierarchy, and an empty tree', () => {
    expect(() => parseUiXml('ERROR: could not get idle state.\n', null)).toThrow('could not get idle state')
    expect(() => parseUiXml(xml(node('bounds="[0,0][0,0]"')), null)).toThrow('empty UI hierarchy')
  })
})
