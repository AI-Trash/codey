import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRuntimeConfig, type CliRuntimeConfig } from '../src/config'
import {
  createNodeHarRecorder,
  fetchWithHarCapture,
} from '../src/modules/authorization/har-recorder'

const tempRoot = path.join(os.tmpdir(), `codey-flows-har-test-${process.pid}`)

function createConfig(rootDir: string, recordHar: boolean): CliRuntimeConfig {
  return {
    rootDir,
    artifactsDir: path.join(rootDir, 'artifacts'),
    browser: {
      headless: true,
      slowMo: 0,
      defaultTimeoutMs: 1000,
      navigationTimeoutMs: 1000,
      recordHar,
    },
    openai: {
      baseUrl: 'https://openai.com',
      chatgptUrl: 'https://chatgpt.com',
    },
    command: 'flow:codex-oauth',
  }
}

describe('authorization HAR capture', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('records node-side OAuth requests into a sidecar HAR file', async () => {
    const rootDir = path.join(tempRoot, 'enabled')
    setRuntimeConfig(createConfig(rootDir, true))

    const recorder = createNodeHarRecorder('flow-codex-oauth-api')
    expect(recorder).toBeDefined()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'access-token',
        }),
        {
          status: 200,
          statusText: 'OK',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
        },
      ),
    )

    const response = await fetchWithHarCapture(
      recorder,
      'https://auth.openai.com/oauth/token?audience=codex',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: 'oauth-code',
          redirect_uri: 'http://localhost:1455/auth/callback',
        }),
      },
      {
        comment: 'Codex OAuth token exchange',
      },
    )

    expect(response.status).toBe(200)
    expect(fs.existsSync(recorder!.path)).toBe(true)

    const har = JSON.parse(fs.readFileSync(recorder!.path, 'utf8')) as {
      log: {
        entries: Array<Record<string, unknown>>
      }
    }
    expect(har.log.entries).toHaveLength(1)
    expect(har.log.entries[0]).toMatchObject({
      comment: 'Codex OAuth token exchange',
      request: {
        method: 'POST',
        url: 'https://auth.openai.com/oauth/token?audience=codex',
      },
      response: {
        status: 200,
      },
    })

    const request = har.log.entries[0].request as {
      postData?: {
        text?: string
      }
    }
    expect(request.postData?.text).toContain('code=oauth-code')
  })

  it('returns no sidecar recorder when HAR capture is disabled', () => {
    const rootDir = path.join(tempRoot, 'disabled')
    setRuntimeConfig(createConfig(rootDir, false))

    expect(createNodeHarRecorder('flow-codex-oauth-api')).toBeUndefined()
  })
})
