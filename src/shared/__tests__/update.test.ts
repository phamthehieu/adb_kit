import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RELEASES_URL, updateMode, updateText } from '../update'

describe('in-app update', () => {
  it('self-installs only where an unsigned build can replace itself', () => {
    expect(updateMode('win32', false)).toBe('install')
    expect(updateMode('linux', true)).toBe('install')
    expect(updateMode('linux', false)).toBe('page') // .deb: owned by the package manager
    expect(updateMode('darwin', false)).toBe('page') // not code-signed
  })

  it('describes every state in one line', () => {
    const t = (state: Parameters<typeof updateText>[0]['state']): string => updateText({ current: '0.10.5', state })
    expect(t({ state: 'idle' })).toBe('Phiên bản 0.10.5')
    expect(t({ state: 'none' })).toContain('mới nhất (0.10.5)')
    expect(t({ state: 'available', version: '0.11.0', mode: 'install' })).toContain('0.11.0')
    expect(t({ state: 'downloading', version: '0.11.0', percent: 42 })).toContain('42%')
    expect(t({ state: 'ready', version: '0.11.0' })).toContain('khởi động lại')
    expect(t({ state: 'error', message: 'net::ERR' })).toContain('net::ERR')
  })

  // The updater reads latest*.yml from the GitHub release; these three places must agree or
  // installed copies silently stop seeing new versions.
  it('package.json, the release workflow and the download link point at the same repository', () => {
    const root = process.cwd()
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const [pub] = pkg.build.publish
    expect(pub.provider).toBe('github')
    expect(RELEASES_URL).toBe(`https://github.com/${pub.owner}/${pub.repo}/releases/latest`)
    for (const name of ['dist', 'dist:win', 'dist:mac', 'dist:linux']) expect(pkg.scripts[name], name).toContain('--publish never')
    expect(pkg.dependencies['electron-updater']).toBeTruthy()
    const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('dist/latest*.yml')
    expect(workflow).toContain('dist/*.blockmap')
  })
})
