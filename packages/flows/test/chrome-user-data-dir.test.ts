import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cloneChromeUserDataDirToTemp,
  shouldCopyChromeUserDataEntry,
} from '../src/utils/chrome-user-data-dir'

const tempRoot = path.join(
  os.tmpdir(),
  `codey-flows-chrome-profile-test-${process.pid}`,
)

function writeFixture(relativePath: string, content: string): void {
  const fullPath = path.join(tempRoot, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
}

describe('chrome user data dir cloning', () => {
  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('copies the selected profile plus minimal root metadata into a temp dir', async () => {
    writeFixture(path.join('source', 'Local State'), '{"browser":{}}')
    writeFixture(path.join('source', 'Variations'), 'seed')
    writeFixture(path.join('source', 'SingletonLock'), 'locked')
    writeFixture(path.join('source', 'Profile 1', 'Preferences'), '{}')
    writeFixture(path.join('source', 'Default', 'Preferences'), '{"ok":true}')
    writeFixture(path.join('source', 'Default', 'Network', 'Cookies'), 'cookie')
    writeFixture(path.join('source', 'Default', 'Extension State', 'state'), '1')
    writeFixture(path.join('source', 'Default', 'Web Data'), 'web-data')
    writeFixture(path.join('source', 'Default', 'Accounts', 'token'), 'token')
    writeFixture(path.join('source', 'Default', 'Cache', 'cache.bin'), 'cache')
    writeFixture(path.join('source', 'Default', 'LOCK'), 'lock')

    const cloned = await cloneChromeUserDataDirToTemp({
      sourceUserDataDir: path.join(tempRoot, 'source'),
      profileDirectory: 'Default',
    })

    try {
      expect(
        fs.readFileSync(
          path.join(cloned.userDataDir, 'Default', 'Preferences'),
          'utf8',
        ),
      ).toContain('"ok":true')
      expect(
        fs.readFileSync(
          path.join(cloned.userDataDir, 'Default', 'Network', 'Cookies'),
          'utf8',
        ),
      ).toBe('cookie')
      expect(
        fs.existsSync(path.join(cloned.userDataDir, 'Profile 1')),
      ).toBe(false)
      expect(
        fs.readFileSync(path.join(cloned.userDataDir, 'Local State'), 'utf8'),
      ).toContain('"browser"')
      expect(
        fs.existsSync(path.join(cloned.userDataDir, 'Variations')),
      ).toBe(false)
      expect(
        fs.existsSync(
          path.join(cloned.userDataDir, 'Default', 'Cache', 'cache.bin'),
        ),
      ).toBe(false)
      expect(
        fs.existsSync(path.join(cloned.userDataDir, 'Default', 'Web Data')),
      ).toBe(false)
      expect(
        fs.existsSync(
          path.join(cloned.userDataDir, 'Default', 'Accounts', 'token'),
        ),
      ).toBe(false)
      expect(
        fs.existsSync(path.join(cloned.userDataDir, 'Default', 'LOCK')),
      ).toBe(false)
      expect(
        fs.existsSync(path.join(cloned.userDataDir, 'SingletonLock')),
      ).toBe(false)
    } finally {
      await cloned.cleanup()
    }

    expect(fs.existsSync(cloned.userDataDir)).toBe(false)
  })

  it('keeps cookies and extension state while skipping transient Chrome entries', () => {
    expect(shouldCopyChromeUserDataEntry('Local State', 'Default')).toBe(true)
    expect(
      shouldCopyChromeUserDataEntry(path.join('Default', 'Network', 'Cookies'), 'Default'),
    ).toBe(true)
    expect(
      shouldCopyChromeUserDataEntry(
        path.join('Default', 'Extension State', 'state'),
        'Default',
      ),
    ).toBe(true)
    expect(
      shouldCopyChromeUserDataEntry(path.join('Default', 'Web Data'), 'Default'),
    ).toBe(false)
    expect(
      shouldCopyChromeUserDataEntry(
        path.join('Default', 'Accounts', 'token'),
        'Default',
      ),
    ).toBe(false)
    expect(
      shouldCopyChromeUserDataEntry(path.join('Default', 'Cache', 'data.bin'), 'Default'),
    ).toBe(false)
    expect(
      shouldCopyChromeUserDataEntry(path.join('Default', 'LOCK'), 'Default'),
    ).toBe(false)
    expect(shouldCopyChromeUserDataEntry('SingletonLock', 'Default')).toBe(
      false,
    )
    expect(
      shouldCopyChromeUserDataEntry(path.join('Profile 1', 'Preferences'), 'Default'),
    ).toBe(false)
  })
})
