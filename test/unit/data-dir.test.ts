import { describe, expect, it } from 'vitest'
import { resolveDataDir } from '@shared/fs/data-dir'

const homedir = '/home/tester'

describe('resolveDataDir', () => {
  it('prefers AIMTHREAD_DATA_DIR over everything', () => {
    const dir = resolveDataDir({
      env: { AIMTHREAD_DATA_DIR: '/custom/dir' },
      isPackaged: true,
      electronUserData: '/appdata/ignored',
      homedir,
      platform: 'darwin'
    })
    expect(dir).toBe('/custom/dir')
  })

  it('ignores a blank AIMTHREAD_DATA_DIR', () => {
    const dir = resolveDataDir({
      env: { AIMTHREAD_DATA_DIR: '   ' },
      isPackaged: true,
      electronUserData: '/appdata/used',
      homedir,
      platform: 'darwin'
    })
    expect(dir).toBe('/appdata/used')
  })

  it('packaged apps use the Electron userData path', () => {
    const dir = resolveDataDir({
      env: {},
      isPackaged: true,
      electronUserData: '/appdata/AimThread',
      homedir,
      platform: 'darwin'
    })
    expect(dir).toBe('/appdata/AimThread')
  })

  it('throws when packaged without a userData path', () => {
    expect(() => resolveDataDir({ env: {}, isPackaged: true, homedir, platform: 'darwin' })).toThrow()
  })

  it('dev uses a platform-default AimThread-dev directory (darwin)', () => {
    const dir = resolveDataDir({ env: {}, isPackaged: false, homedir, platform: 'darwin' })
    expect(dir).toBe(`${homedir}/Library/Application Support/AimThread-dev`)
  })

  it('dev uses a platform-default AimThread-dev directory (linux)', () => {
    const dir = resolveDataDir({ env: {}, isPackaged: false, homedir, platform: 'linux' })
    expect(dir).toBe(`${homedir}/.local/share/AimThread-dev`)
  })

  it('dev uses a platform-default AimThread-dev directory (win32)', () => {
    const dir = resolveDataDir({ env: {}, isPackaged: false, homedir, platform: 'win32' })
    expect(dir).toBe(`${homedir}/AppData/Roaming/AimThread-dev`)
  })
})
