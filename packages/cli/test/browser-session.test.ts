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

  it('passes configured proxy settings to disposable browser contexts', async () => {
    const artifactsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codey-browser-artifacts-'),
    )
    tempDirs.push(artifactsDir)

    const page = createOpenPage()
    const context = {
      pages: vi.fn(() => []),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    }
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    }

    getRuntimeConfigMock.mockReturnValue({
      command: 'flow:codex-oauth',
      artifactsDir,
      browser: {
        recordHar: false,
        headless: false,
        slowMo: undefined,
        defaultTimeoutMs: 30000,
        navigationTimeoutMs: 45000,
        proxy: {
          server: 'http://127.0.0.1:7890',
          bypass: 'localhost,127.0.0.1,::1',
        },
      },
    })
    launchMock.mockResolvedValue(browser)

    await newSession()

    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: {
          server: 'http://127.0.0.1:7890',
          bypass: 'localhost,127.0.0.1,::1',
        },
      }),
    )
  })

  it('loads a provided storage state before resolving the session page', async () => {
    const artifactsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'codey-browser-artifacts-'),
    )
    const storageStatePath = path.join(artifactsDir, 'state.json')
    tempDirs.push(artifactsDir)

    const calls: string[] = []
    const page = createOpenPage()
    const context = {
      pages: vi.fn(() => {
        calls.push('pages')
        return []
      }),
      newPage: vi.fn(async () => {
        calls.push('newPage')
        return page
      }),
      setStorageState: vi.fn(async () => {
        calls.push('setStorageState')
      }),
      close: vi.fn(async () => undefined),
    }
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    }

    getRuntimeConfigMock.mockReturnValue({
      command: 'flow:chatgpt-login',
      artifactsDir,
      browser: {
        recordHar: false,
        headless: false,
        slowMo: undefined,
        defaultTimeoutMs: 30000,
        navigationTimeoutMs: 45000,
      },
    })
    launchMock.mockResolvedValue(browser)

    await newSession({
      storageStatePath,
    })

    expect(context.setStorageState).toHaveBeenCalledWith(storageStatePath)
    expect(calls).toEqual(['setStorageState', 'pages', 'newPage'])
  })
})
