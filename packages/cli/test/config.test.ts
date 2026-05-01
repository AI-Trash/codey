import { describe, expect, it } from 'vitest'
import { defaultCodexOAuthConfig, resolveConfig } from '../src/config'
import {
  buildRuntimeConfig,
  type FlowOptions,
} from '../src/modules/flow-cli/helpers'
import {
  parseWindowsInternetSettingsProxy,
  resolveProxyConfig,
} from '../src/utils/proxy'
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

const sub2apiEnvNames = {
  SUB2API_BASE_URL: undefined,
  SUB2API_API_KEY: undefined,
  SUB2API_BEARER_TOKEN: '',
  SUB2API_EMAIL: undefined,
  SUB2API_PASSWORD: undefined,
  SUB2API_LOGIN_PATH: undefined,
  SUB2API_REFRESH_TOKEN_PATH: undefined,
  SUB2API_ACCOUNTS_PATH: undefined,
  SUB2API_CLIENT_ID: undefined,
  SUB2API_PROXY_ID: undefined,
  SUB2API_CONCURRENCY: undefined,
  SUB2API_PRIORITY: undefined,
  SUB2API_GROUP_IDS: undefined,
  SUB2API_AUTO_FILL_RELATED_MODELS: undefined,
  SUB2API_CONFIRM_MIXED_CHANNEL_RISK: undefined,
}

const proxyEnvNames = {
  CODEY_PROXY_URL: undefined,
  CODEY_PROXY_SERVER: undefined,
  CODEY_BROWSER_PROXY_URL: undefined,
  CODEY_BROWSER_PROXY_SERVER: undefined,
  CODEX_PROXY_URL: undefined,
  CODEY_PROXY_BYPASS: undefined,
  CODEY_PROXY_USERNAME: undefined,
  CODEY_PROXY_PASSWORD: undefined,
  CODEY_USE_SYSTEM_PROXY: 'false',
  HTTPS_PROXY: undefined,
  https_proxy: undefined,
  ALL_PROXY: undefined,
  all_proxy: undefined,
  HTTP_PROXY: undefined,
  http_proxy: undefined,
  NO_PROXY: undefined,
  no_proxy: undefined,
}

const androidEnvNames = {
  ANDROID_ADB_PATH: undefined,
  APPIUM_SERVER_URL: undefined,
  ANDROID_UDID: undefined,
  ANDROID_DEVICE_NAME: undefined,
  ANDROID_PLATFORM_VERSION: undefined,
  ANDROID_AUTOMATION_NAME: undefined,
  ANDROID_APP_PACKAGE: undefined,
  ANDROID_APP_ACTIVITY: undefined,
  ANDROID_NO_RESET: undefined,
}

const smsForwarderWebhookEnvNames = {
  SMS_FORWARDER_WEBHOOK_ENABLED: undefined,
  SMS_FORWARDER_WEBHOOK_HOST: undefined,
  SMS_FORWARDER_WEBHOOK_PORT: undefined,
  SMS_FORWARDER_WEBHOOK_PATH: undefined,
  SMS_FORWARDER_DEVICE_ID: undefined,
}

const singBoxEnvNames = {
  CODEY_SINGBOX_ENABLED: undefined,
  CODEY_SINGBOX_EXECUTABLE: undefined,
  CODEY_SINGBOX_AUTO_INSTALL: undefined,
  CODEY_SINGBOX_VERSION: undefined,
  CODEY_SINGBOX_MIXED_HOST: undefined,
  CODEY_SINGBOX_MIXED_PORT: undefined,
  CODEY_SINGBOX_AUTO_START: undefined,
  CODEY_SINGBOX_DEFAULT_TAG: undefined,
  CODEY_SINGBOX_CONFIG_DIR: undefined,
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

describe('resolveConfig Android Appium config', () => {
  it('uses conservative Appium defaults when env overrides are absent', async () => {
    const config = await withEnv(
      {
        ...androidEnvNames,
        ...smsForwarderWebhookEnvNames,
        ...singBoxEnvNames,
      },
      () => resolveConfig(),
    )

    expect(config.android).toMatchObject({
      appiumServerUrl: 'http://127.0.0.1:4723',
      automationName: 'UiAutomator2',
      deviceName: 'Android',
      noReset: true,
    })
    expect(config.smsForwarderWebhook).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 3001,
      path: '/webhooks/smsforwarder/whatsapp',
      deviceId: undefined,
    })
    expect(config.singBox).toEqual({
      enabled: true,
      executable: undefined,
      autoInstall: true,
      version: undefined,
      mixedHost: '127.0.0.1',
      mixedPort: 2080,
      autoStart: true,
      defaultTag: undefined,
      configDir: undefined,
    })
  })

  it('reads managed sing-box proxy env vars', async () => {
    const config = await withEnv(
      {
        ...singBoxEnvNames,
        CODEY_SINGBOX_ENABLED: 'false',
        CODEY_SINGBOX_EXECUTABLE: 'C:\\tools\\sing-box.exe',
        CODEY_SINGBOX_AUTO_INSTALL: 'false',
        CODEY_SINGBOX_VERSION: '1.13.11',
        CODEY_SINGBOX_MIXED_HOST: '127.0.0.2',
        CODEY_SINGBOX_MIXED_PORT: '2088',
        CODEY_SINGBOX_AUTO_START: 'false',
        CODEY_SINGBOX_DEFAULT_TAG: 'singapore',
        CODEY_SINGBOX_CONFIG_DIR: 'C:\\tmp\\codey-sing-box',
      },
      () => resolveConfig(),
    )

    expect(config.singBox).toEqual({
      enabled: false,
      executable: 'C:\\tools\\sing-box.exe',
      autoInstall: false,
      version: '1.13.11',
      mixedHost: '127.0.0.2',
      mixedPort: 2088,
      autoStart: false,
      defaultTag: 'singapore',
      configDir: 'C:\\tmp\\codey-sing-box',
    })
  })

  it('maps Android flow options into runtime config overrides', () => {
    const options: FlowOptions = {
      appiumServerUrl: 'http://localhost:4723/wd/hub',
      androidUdid: 'emulator-5554',
      androidDeviceName: 'Pixel 8',
      androidPlatformVersion: '15',
      androidAutomationName: 'UiAutomator2',
      androidAppPackage: 'com.example.app',
      androidAppActivity: '.MainActivity',
      androidNoReset: false,
    }
    const config = buildRuntimeConfig('flow:android-healthcheck', options)

    expect(config.android).toMatchObject({
      appiumServerUrl: 'http://localhost:4723/wd/hub',
      udid: 'emulator-5554',
      deviceName: 'Pixel 8',
      platformVersion: '15',
      automationName: 'UiAutomator2',
      appPackage: 'com.example.app',
      appActivity: '.MainActivity',
      noReset: false,
    })
  })
})

describe('resolveConfig sub2api sync config', () => {
  it('reads Sub2API API-key env vars into sync config', async () => {
    const config = await withEnv(
      {
        ...sub2apiEnvNames,
        SUB2API_BASE_URL: 'https://sub2api.example.com',
        SUB2API_API_KEY: 'admin-test-api-key',
      },
      () => resolveConfig(),
    )

    expect(config.sub2api).toEqual({
      baseUrl: 'https://sub2api.example.com',
      apiKey: 'admin-test-api-key',
      bearerToken: '',
      email: undefined,
      password: undefined,
      loginPath: undefined,
      refreshTokenPath: undefined,
      accountsPath: undefined,
      clientId: undefined,
      proxyId: undefined,
      concurrency: undefined,
      priority: undefined,
      groupIds: undefined,
      autoFillRelatedModels: undefined,
      confirmMixedChannelRisk: undefined,
    })
  })

  it('reads SUB2API env vars into sync config', async () => {
    const config = await withEnv(
      {
        ...sub2apiEnvNames,
        SUB2API_BASE_URL: 'https://sub2api.example.com',
        SUB2API_BEARER_TOKEN: 'sub2api-bearer',
        SUB2API_CONCURRENCY: '3',
        SUB2API_PRIORITY: '7',
        SUB2API_GROUP_IDS: '11, 12, invalid, 13',
        SUB2API_AUTO_FILL_RELATED_MODELS: 'true',
        SUB2API_CONFIRM_MIXED_CHANNEL_RISK: 'true',
      },
      () => resolveConfig(),
    )

    expect(config.sub2api).toEqual({
      baseUrl: 'https://sub2api.example.com',
      apiKey: undefined,
      bearerToken: 'sub2api-bearer',
      email: undefined,
      password: undefined,
      loginPath: undefined,
      refreshTokenPath: undefined,
      accountsPath: undefined,
      clientId: undefined,
      proxyId: undefined,
      concurrency: 3,
      priority: 7,
      groupIds: [11, 12, 13],
      autoFillRelatedModels: true,
      confirmMixedChannelRisk: true,
    })
  })

  it('reads Sub2API password-login env vars into sync config', async () => {
    const config = await withEnv(
      {
        ...sub2apiEnvNames,
        SUB2API_BASE_URL: 'https://sub2api.example.com',
        SUB2API_EMAIL: 'admin@example.com',
        SUB2API_PASSWORD: 'super-secret',
        SUB2API_LOGIN_PATH: '/api/v1/auth/login',
      },
      () => resolveConfig(),
    )

    expect(config.sub2api).toEqual({
      baseUrl: 'https://sub2api.example.com',
      apiKey: undefined,
      bearerToken: '',
      email: 'admin@example.com',
      password: 'super-secret',
      loginPath: '/api/v1/auth/login',
      refreshTokenPath: undefined,
      accountsPath: undefined,
      clientId: undefined,
      proxyId: undefined,
      concurrency: undefined,
      priority: undefined,
      groupIds: undefined,
      autoFillRelatedModels: undefined,
      confirmMixedChannelRisk: undefined,
    })
  })
})

describe('chrome profile launch config', () => {
  it('merges runtime config overrides into the resolved config', () => {
    const config = buildRuntimeConfig('flow:codex-oauth', {
      runtimeConfigOverrides: {
        sub2api: {
          baseUrl: 'https://sub2api.example.com',
          bearerToken: 'sub2api-bearer',
        },
      },
    })

    expect(config.sub2api).toEqual({
      baseUrl: 'https://sub2api.example.com',
      bearerToken: 'sub2api-bearer',
    })
  })

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

describe('browser proxy config', () => {
  it('reads explicit proxy env vars into browser config', async () => {
    const config = await withEnv(
      {
        ...proxyEnvNames,
        CODEY_PROXY_URL: 'http://user:pass@127.0.0.1:7890',
        CODEY_PROXY_BYPASS: 'example.test;*.internal',
      },
      () => resolveConfig(),
    )

    expect(config.browser.proxy).toEqual({
      server: 'http://127.0.0.1:7890',
      bypass: 'localhost,127.0.0.1,::1,example.test,*.internal',
      username: 'user',
      password: 'pass',
    })
  })

  it('parses enabled Windows system proxy settings', () => {
    expect(
      parseWindowsInternetSettingsProxy(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7891;socks=127.0.0.1:1080
    ProxyOverride    REG_SZ    <local>;*.lan
`),
    ).toEqual({
      server: 'http://127.0.0.1:7891',
      bypass: 'localhost,127.0.0.1,::1,<local>,*.lan',
      username: undefined,
      password: undefined,
    })
  })

  it('prefers the Windows system proxy when no explicit env var is set', () => {
    expect(
      resolveProxyConfig({
        env: {
          ...proxyEnvNames,
          CODEY_USE_SYSTEM_PROXY: undefined,
        },
        platform: 'win32',
        queryWindowsProxy: () => `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:10808
    ProxyOverride    REG_SZ    <local>;127.*;192.168.*
`,
      }),
    ).toEqual({
      server: 'http://127.0.0.1:10808',
      bypass: 'localhost,127.0.0.1,::1,<local>,127.*,192.168.*',
      username: undefined,
      password: undefined,
    })
  })

  it('ignores disabled Windows system proxy settings', () => {
    expect(
      parseWindowsInternetSettingsProxy(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x0
    ProxyServer    REG_SZ    127.0.0.1:7890
`),
    ).toBeUndefined()
  })
})
