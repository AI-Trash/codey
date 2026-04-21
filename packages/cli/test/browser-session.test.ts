import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { launchMock, launchPersistentContextMock, getRuntimeConfigMock } =
  vi.hoisted(() => ({
    launchMock: vi.fn(),
    launchPersistentContextMock: vi.fn(),
    getRuntimeConfigMock: vi.fn(),
  }))

vi.mock('patchright', () => ({
  chromium: {
    launch: launchMock,
    launchPersistentContext: launchPersistentContextMock,
  },
}))

vi.mock('../src/config', () => ({
  getRuntimeConfig: getRuntimeConfigMock,
}))

import { newSession } from '../src/core/browser'

function createOpenPage() {
  return {
    isClosed: vi.fn(() => false),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
  }
}

function createClosedPage() {
  return {
    isClosed: vi.fn(() => true),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
  }
}

describe('newSession', () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reuses the existing default page for persistent Chrome profile sessions', async () => {
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codey-browser-session-'),
    )
    const artifactsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codey-browser-artifacts-'),
    )
    tempDirs.push(userDataDir, artifactsDir)
    fs.mkdirSync(path.join(userDataDir, 'Default'))

    const defaultPage = createOpenPage()
    const browser = {
      close: vi.fn(async () => undefined),
    }
    const context = {
      browser: vi.fn(() => browser),
      pages: vi.fn(() => [defaultPage]),
      newPage: vi.fn(),
      close: vi.fn(async () => undefined),
    }

    getRuntimeConfigMock.mockReturnValue({
      command: 'flow:chatgpt-login',
      artifactsDir,
      browser: {
        recordHar: false,
        userDataDir,
        profileDirectory: 'Default',
        cloneUserDataDirToTemp: false,
        headless: false,
        slowMo: undefined,
        defaultTimeoutMs: 30000,
        navigationTimeoutMs: 45000,
      },
    })
    launchPersistentContextMock.mockResolvedValue(context)

    const session = await newSession()

    expect(launchPersistentContextMock).toHaveBeenCalledOnce()
    expect(context.newPage).not.toHaveBeenCalled()
    expect(session.page).toBe(defaultPage)
    expect(defaultPage.setDefaultTimeout).toHaveBeenCalledWith(30000)
    expect(defaultPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(45000)

    await session.close()

    expect(context.close).toHaveBeenCalledOnce()
    expect(browser.close).toHaveBeenCalledOnce()
  })

  it('falls back to a fresh page when the persistent context has no open pages', async () => {
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codey-browser-session-'),
    )
    const artifactsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codey-browser-artifacts-'),
    )
    tempDirs.push(userDataDir, artifactsDir)
    fs.mkdirSync(path.join(userDataDir, 'Default'))

    const closedPage = createClosedPage()
    const freshPage = createOpenPage()
    const browser = {
      close: vi.fn(async () => undefined),
    }
    const context = {
      browser: vi.fn(() => browser),
      pages: vi.fn(() => [closedPage]),
      newPage: vi.fn(async () => freshPage),
      close: vi.fn(async () => undefined),
    }

    getRuntimeConfigMock.mockReturnValue({
      command: 'flow:chatgpt-login',
      artifactsDir,
      browser: {
        recordHar: false,
        userDataDir,
        profileDirectory: 'Default',
        cloneUserDataDirToTemp: false,
        headless: false,
        slowMo: undefined,
        defaultTimeoutMs: 30000,
        navigationTimeoutMs: 45000,
      },
    })
    launchPersistentContextMock.mockResolvedValue(context)

    const session = await newSession()

    expect(context.newPage).toHaveBeenCalledOnce()
    expect(session.page).toBe(freshPage)
    expect(freshPage.setDefaultTimeout).toHaveBeenCalledWith(30000)
    expect(freshPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(45000)
  })
})
