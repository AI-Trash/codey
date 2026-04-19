import { describe, expect, it } from 'vitest'
import { defaultCodexOAuthConfig, resolveConfig } from '../src/config'
import { buildRuntimeConfig } from '../src/modules/flow-cli/helpers'
import {
  resolveChromeProfileLaunchConfig,
  resolveDefaultChromeUserDataDir,
} from '../src/utils/chrome-profile'

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

const codexEnvNames = {
  CODEX_AUTHORIZE_URL: undefined,
  CODEX_TOKEN_URL: undefined,
  CODEX_CLIENT_ID: undefined,
  CODEX_CLIENT_SECRET: undefined,
  CODEX_SCOPE: undefined,
  CODEX_REDIRECT_HOST: undefined,
  CODEX_REDIRECT_PORT: undefined,
  CODEX_REDIRECT_PATH: undefined,
}

describe('resolveConfig codex defaults', () => {
  it('uses built-in Codex OAuth defaults when env overrides are absent', async () => {
    const config = await withEnv(codexEnvNames, () => resolveConfig())

    expect(config.codex).toMatchObject(defaultCodexOAuthConfig)
    expect(config.codex?.clientSecret).toBeUndefined()
    expect(config.codex?.redirectHost).toBe('localhost')
    expect(config.codex?.redirectPort).toBe(1455)
    expect(config.codex?.redirectPath).toBe('/auth/callback')
  })

  it('lets env overrides replace individual Codex OAuth fields', async () => {
    const config = await withEnv(
      {
        ...codexEnvNames,
        CODEX_TOKEN_URL: 'https://example.test/codex/token',
        CODEX_REDIRECT_PORT: '1455',
      },
      () => resolveConfig(),
    )

    expect(config.codex?.authorizeUrl).toBe(
      defaultCodexOAuthConfig.authorizeUrl,
    )
    expect(config.codex?.tokenUrl).toBe('https://example.test/codex/token')
    expect(config.codex?.clientId).toBe(defaultCodexOAuthConfig.clientId)
    expect(config.codex?.scope).toBe(defaultCodexOAuthConfig.scope)
    expect(config.codex?.redirectPort).toBe(1455)
  })
})

describe('chrome profile launch config', () => {
  it('maps chromeDefaultProfile to the local Chrome Default profile', async () => {
    const userDataDir =
      'C:\\Users\\Summp\\AppData\\Local\\Google\\Chrome\\User Data'
    const config = await withEnv(
      {
        CHROME_USER_DATA_DIR: userDataDir,
      },
      () =>
        buildRuntimeConfig('flow:chatgpt-login', {
          chromeDefaultProfile: true,
        }),
    )

    expect(config.browser.userDataDir).toBe(userDataDir)
    expect(config.browser.profileDirectory).toBe('Default')
    expect(config.browser.cloneUserDataDirToTemp).toBe(true)
  })

  it('derives the default Chrome user data directory from the platform', () => {
    expect(
      resolveDefaultChromeUserDataDir(
        'win32',
        {
          LOCALAPPDATA: 'C:\\Users\\Summp\\AppData\\Local',
        },
        'C:\\Users\\Summp',
      ),
    ).toBe('C:\\Users\\Summp\\AppData\\Local\\Google\\Chrome\\User Data')
  })

  it('resolves a Default profile launch config when the switch is enabled', () => {
    expect(
      resolveChromeProfileLaunchConfig({
        useDefaultProfile: true,
        platform: 'win32',
        env: {
          LOCALAPPDATA: 'C:\\Users\\Summp\\AppData\\Local',
        },
        homeDir: 'C:\\Users\\Summp',
      }),
    ).toEqual({
      userDataDir:
        'C:\\Users\\Summp\\AppData\\Local\\Google\\Chrome\\User Data',
      profileDirectory: 'Default',
    })
  })
})
