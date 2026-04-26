import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getRuntimeConfig, setRuntimeConfig } from '../src/config'
import { saveStablePageContent } from '../src/modules/flow-cli/page-content'

describe('stable page content capture', () => {
  const previousConfig = getRuntimeConfig()
  let artifactsDir = ''

  beforeEach(() => {
    artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codey-page-content-'))
    setRuntimeConfig({
      ...previousConfig,
      command: 'flow:chatgpt-login',
      artifactsDir,
    })
  })

  afterEach(() => {
    setRuntimeConfig(previousConfig)
    fs.rmSync(artifactsDir, { recursive: true, force: true })
  })

  it('writes the first repeated page.content() snapshot to an HTML artifact', async () => {
    const page = {
      isClosed: vi.fn(() => false),
      waitForLoadState: vi.fn(async () => undefined),
      content: vi
        .fn()
        .mockResolvedValueOnce('<html><body>loading</body></html>')
        .mockResolvedValueOnce('<html><body>ready</body></html>')
        .mockResolvedValueOnce('<html><body>ready</body></html>'),
    }

    const filePath = await saveStablePageContent(page as never, {
      artifactName: 'ChatGPT Login',
      pollIntervalMs: 1,
      stabilityTimeoutMs: 100,
    })

    expect(path.dirname(filePath)).toBe(artifactsDir)
    expect(path.basename(filePath)).toMatch(
      /^\d{4}-.*-chatgpt-login-page-content\.html$/,
    )
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      '<html><body>ready</body></html>',
    )
    expect(page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', {
      timeout: 1500,
    })
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', {
      timeout: 1500,
    })
  })
})
