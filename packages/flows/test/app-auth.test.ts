import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildOidcDiscoveryUrl,
  getOidcDiscovery,
  OidcRequestError,
  resolveOidcIssuer,
} from '../src/modules/app-auth/oidc'
import {
  clearAppSession,
  readAppSession,
} from '../src/modules/app-auth/token-store'
import {
  resolveConfig,
  setRuntimeConfig,
  type CliRuntimeConfig,
} from '../src/config'

const tempRoot = path.join(os.tmpdir(), `codey-flows-test-${process.pid}`)

function createConfig(rootDir: string): CliRuntimeConfig {
  return {
    rootDir,
    artifactsDir: path.join(rootDir, 'artifacts'),
    browser: {
      headless: true,
      slowMo: 0,
      defaultTimeoutMs: 1000,
      navigationTimeoutMs: 1000,
      recordHar: false,
    },
    openai: {
      baseUrl: 'https://openai.com',
      chatgptUrl: 'https://chatgpt.com',
    },
    app: {
      baseUrl: 'http://localhost:3000',
      oidcBasePath: '/oidc',
      clientId: 'codey_cli',
      clientSecret: 'secret',
      scope: 'notifications:read',
    },
  }
}

function getAppSessionStorePath(rootDir: string): string {
  return path.join(rootDir, '.codey', 'credentials', 'app-session.json')
}

async function withEnv<T>(
  values: Record<string, string | undefined>,
  callback: () => Promise<T> | T,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  )

  for (const [key, value] of Object.entries(values)) {
    if (value == null) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await callback()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe('app auth OIDC helpers', () => {
  afterEach(() => {
    setRuntimeConfig(createConfig(tempRoot))
    clearAppSession()
    vi.restoreAllMocks()
  })

  it('resolves an issuer from baseUrl and oidcBasePath', () => {
    expect(
      resolveOidcIssuer({
        baseUrl: 'http://localhost:3000',
        oidcBasePath: '/oidc',
      }),
    ).toBe('http://localhost:3000/oidc')
    expect(
      buildOidcDiscoveryUrl({
        baseUrl: 'http://localhost:3000',
        oidcBasePath: '/oidc',
      }),
    ).toBe('http://localhost:3000/oidc/.well-known/openid-configuration')
  })

  it('applies oidcBasePath to a root issuer override', () => {
    expect(
      resolveOidcIssuer({
        oidcIssuer: 'http://localhost:3000',
        oidcBasePath: '/oidc',
      }),
    ).toBe('http://localhost:3000/oidc')
    expect(
      resolveOidcIssuer({
        oidcIssuer: 'http://localhost:3000/custom-oidc',
        oidcBasePath: '/oidc',
      }),
    ).toBe('http://localhost:3000/custom-oidc')
  })

  it('surfaces non-standard OIDC error payload details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: true,
          detail: 'OAUTH_JWKS_JSON is required before initializing the OIDC provider',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    await expect(
      getOidcDiscovery({
        baseUrl: 'http://localhost:4050',
        oidcBasePath: '/oidc',
      }),
    ).rejects.toMatchObject<Partial<OidcRequestError>>({
      message:
        'OAUTH_JWKS_JSON is required before initializing the OIDC provider',
      status: 500,
      error: undefined,
      errorDescription:
        'OAUTH_JWKS_JSON is required before initializing the OIDC provider',
    })
  })

  it('reads legacy app session files through the new tokenSet shape', () => {
    const rootDir = path.join(tempRoot, 'legacy')
    setRuntimeConfig(createConfig(rootDir))
    const storePath = getAppSessionStorePath(rootDir)
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          accessToken: 'token-123',
          target: 'octocat',
          createdAt: '2026-04-16T00:00:00.000Z',
        },
        null,
        2,
      ),
    )

    const session = readAppSession()
    expect(session.version).toBe(2)
    expect(session.tokenSet.accessToken).toBe('token-123')
    expect(session.tokenSet.tokenType).toBe('Bearer')
    expect(session.target).toBe('octocat')
  })

  it('reads unified CODEY_APP_* env vars into shared app config', async () => {
    await withEnv(
      {
        CODEY_APP_BASE_URL: 'http://localhost:4010',
        CODEY_APP_CLIENT_ID: 'codey_client',
        CODEY_APP_CLIENT_SECRET: 'codey_secret',
        CODEY_APP_RESERVE_EMAIL_PATH: '/api/custom/reservations',
        CODEY_APP_CODE_PATH: '/api/custom/codes',
        CODEY_APP_EVENTS_PATH: '/api/custom/events',
        CODEY_APP_CLI_EVENTS_PATH: '/api/custom/cli-events',
      },
      async () => {
        const config = resolveConfig()
        expect(config.app?.baseUrl).toBe('http://localhost:4010')
        expect(config.app?.clientId).toBe('codey_client')
        expect(config.app?.clientSecret).toBe('codey_secret')
        expect(config.app?.scope).toBeUndefined()
        expect(config.app?.reserveEmailPath).toBe('/api/custom/reservations')
        expect(config.verification?.app?.verificationCodePath).toBe(
          '/api/custom/codes',
        )
        expect(config.verification?.app?.verificationEventsPath).toBe(
          '/api/custom/events',
        )
        expect(config.app?.cliEventsPath).toBe('/api/custom/cli-events')
      },
    )
  })

  it('ignores removed legacy app env vars', async () => {
    await withEnv(
      {
        APP_BASE_URL: 'http://localhost:4020',
        APP_OIDC_CLIENT_ID: 'legacy_client',
        APP_OIDC_CLIENT_SECRET: 'legacy_secret',
        VERIFICATION_APP_BASE_URL: 'http://localhost:4021',
        VERIFICATION_APP_OIDC_CLIENT_ID: 'legacy_verification_client',
        CODEY_APP_BASE_URL: '',
        CODEY_APP_CLIENT_ID: '',
        CODEY_APP_CLIENT_SECRET: '',
        CODEY_APP_RESERVE_EMAIL_PATH: '',
        CODEY_APP_CODE_PATH: '',
        CODEY_APP_EVENTS_PATH: '',
        CODEY_APP_CLI_EVENTS_PATH: '',
      },
      async () => {
        const config = resolveConfig()
        expect(config.app).toBeUndefined()
        expect(config.verification).toBeUndefined()
      },
    )
  })
})
