import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadWorkspaceEnv } from './utils/env'
import { resolveProxyConfig, type ProxyConfig } from './utils/proxy'
import { resolveWorkspaceRoot } from './utils/workspace-root'

export interface BrowserCliConfig {
  headless: boolean
  slowMo: number
  defaultTimeoutMs: number
  navigationTimeoutMs: number
  recordHar: boolean
  proxy?: ProxyConfig
  userDataDir?: string
  profileDirectory?: string
  cloneUserDataDirToTemp?: boolean
}

export interface AndroidCliConfig {
  appiumServerUrl: string
  automationName: string
  deviceName: string
  platformVersion?: string
  udid?: string
  appPackage?: string
  appActivity?: string
  noReset?: boolean
}

export interface OpenAIFlowConfig {
  baseUrl: string
  chatgptUrl: string
}

export interface ExchangeAuthConfig {
  mode: 'client_credentials'
  tenantId: string
  clientId: string
  clientSecret: string
}

export interface ExchangeMailFlowCatchAllConfig {
  prefix?: string
}

export interface ExchangeConfig {
  auth: ExchangeAuthConfig
  mailbox?: string
  mailFlow?: {
    catchAll?: ExchangeMailFlowCatchAllConfig
  }
}

export type OidcTokenEndpointAuthMethod =
  | 'client_secret_basic'
  | 'client_secret_post'

export interface OidcEndpointConfig {
  oidcIssuer?: string
  oidcBasePath?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  resource?: string
  tokenEndpointAuthMethod?: OidcTokenEndpointAuthMethod
}

export type VerificationProviderConfigKind = 'exchange' | 'app'

export interface CodeyAppConfig extends OidcEndpointConfig {
  baseUrl?: string
  cliEventsPath?: string
  deviceStartPath?: string
  deviceStatusPath?: string
  deviceEventsPath?: string
  reserveEmailPath?: string
  verificationCodePath?: string
  verificationEventsPath?: string
}

export type AppVerificationProviderConfig = CodeyAppConfig

export interface VerificationConfig {
  provider?: VerificationProviderConfigKind
  app?: AppVerificationProviderConfig
}

export type AppAuthConfig = CodeyAppConfig

export interface CodexOAuthConfig {
  authorizeUrl?: string
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  redirectHost?: string
  redirectPort?: number
  redirectPath?: string
}

export interface Sub2ApiConfig {
  baseUrl?: string
  apiKey?: string
  bearerToken?: string
  email?: string
  password?: string
  loginPath?: string
  refreshTokenPath?: string
  accountsPath?: string
  clientId?: string
  proxyId?: number
  concurrency?: number
  priority?: number
  groupIds?: number[]
  autoFillRelatedModels?: boolean
  confirmMixedChannelRisk?: boolean
  openaiOAuthResponsesWebSocketV2Mode?: 'off' | 'ctx_pool' | 'passthrough'
}

export interface ChatGPTTeamTrialBillingAddressConfig {
  name?: string
  country?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
}

export interface ChatGPTTeamTrialGoPayConfig {
  countryCode?: string
  phoneNumber?: string
  pin?: string
  authorizationTimeoutMs?: number
}

export interface ChatGPTTeamTrialConfig {
  billingAddress?: ChatGPTTeamTrialBillingAddressConfig
  gopay?: ChatGPTTeamTrialGoPayConfig
}

export interface AppConfig {
  rootDir: string
  artifactsDir: string
  browser: BrowserCliConfig
  android?: AndroidCliConfig
  openai: OpenAIFlowConfig
  exchange?: ExchangeConfig
  verification?: VerificationConfig
  app?: AppAuthConfig
  codex?: CodexOAuthConfig
  sub2api?: Sub2ApiConfig
  chatgptTeamTrial?: ChatGPTTeamTrialConfig
}

export interface CliRuntimeConfig extends AppConfig {
  command?: string
  profile?: string
  configFile?: string
}

export const defaultCodexOAuthConfig = {
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  scope: 'openid profile email offline_access',
  redirectHost: 'localhost',
  redirectPort: 1455,
  redirectPath: '/auth/callback',
} satisfies Required<
  Pick<
    CodexOAuthConfig,
    | 'authorizeUrl'
    | 'tokenUrl'
    | 'clientId'
    | 'scope'
    | 'redirectHost'
    | 'redirectPort'
    | 'redirectPath'
  >
>

export type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K]
}

export type RuntimeConfigOverrides = PartialDeep<AppConfig>

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function parseNumber(value: string | undefined, fallback: number): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null || value === '') {
    return undefined
  }

  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

function hasEnvValue(value: string | undefined): boolean {
  return value != null && value !== ''
}

function hasAnyDefinedEnv(names: string[]): boolean {
  return names.some((name) => hasEnvValue(process.env[name]))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseVerificationProviderConfigKind(
  value: string | undefined,
): VerificationProviderConfigKind | undefined {
  if (!value) return undefined
  if (value === 'exchange' || value === 'app') return value
  return undefined
}

function parseOidcTokenEndpointAuthMethod(
  value: string | undefined,
): OidcTokenEndpointAuthMethod | undefined {
  if (!value) return undefined
  if (value === 'client_secret_basic' || value === 'client_secret_post') {
    return value
  }
  return undefined
}

function buildCodeyAppConfig(): CodeyAppConfig | undefined {
  const relevantEnvNames = [
    'CODEY_APP_BASE_URL',
    'CODEY_APP_OIDC_ISSUER',
    'CODEY_APP_OIDC_BASE_PATH',
    'CODEY_APP_CLIENT_ID',
    'CODEY_APP_CLIENT_SECRET',
    'CODEY_APP_RESOURCE',
    'CODEY_APP_TOKEN_ENDPOINT_AUTH_METHOD',
    'CODEY_APP_CLI_EVENTS_PATH',
    'CODEY_APP_DEVICE_START_PATH',
    'CODEY_APP_DEVICE_STATUS_PATH',
    'CODEY_APP_DEVICE_EVENTS_PATH',
    'CODEY_APP_RESERVE_EMAIL_PATH',
    'CODEY_APP_CODE_PATH',
    'CODEY_APP_EVENTS_PATH',
  ]

  if (!hasAnyDefinedEnv(relevantEnvNames)) {
    return undefined
  }

  return {
    baseUrl: process.env.CODEY_APP_BASE_URL,
    oidcIssuer: process.env.CODEY_APP_OIDC_ISSUER,
    oidcBasePath: process.env.CODEY_APP_OIDC_BASE_PATH,
    clientId: process.env.CODEY_APP_CLIENT_ID,
    clientSecret: process.env.CODEY_APP_CLIENT_SECRET,
    resource: process.env.CODEY_APP_RESOURCE,
    tokenEndpointAuthMethod: parseOidcTokenEndpointAuthMethod(
      process.env.CODEY_APP_TOKEN_ENDPOINT_AUTH_METHOD,
    ),
    cliEventsPath: process.env.CODEY_APP_CLI_EVENTS_PATH,
    deviceStartPath: process.env.CODEY_APP_DEVICE_START_PATH,
    deviceStatusPath: process.env.CODEY_APP_DEVICE_STATUS_PATH,
    deviceEventsPath: process.env.CODEY_APP_DEVICE_EVENTS_PATH,
    reserveEmailPath: process.env.CODEY_APP_RESERVE_EMAIL_PATH,
    verificationCodePath: process.env.CODEY_APP_CODE_PATH,
    verificationEventsPath: process.env.CODEY_APP_EVENTS_PATH,
  }
}

function parseIntegerList(value: string | undefined): number[] | undefined {
  if (!hasEnvValue(value)) {
    return undefined
  }

  const rawValue = value ?? ''
  const parsed = rawValue
    .trim()
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0)

  return parsed.length > 0 ? parsed : undefined
}

function buildSub2ApiConfig(): Sub2ApiConfig | undefined {
  const relevantEnvNames = [
    'SUB2API_BASE_URL',
    'SUB2API_API_KEY',
    'SUB2API_BEARER_TOKEN',
    'SUB2API_EMAIL',
    'SUB2API_PASSWORD',
    'SUB2API_LOGIN_PATH',
    'SUB2API_REFRESH_TOKEN_PATH',
    'SUB2API_ACCOUNTS_PATH',
    'SUB2API_CLIENT_ID',
    'SUB2API_PROXY_ID',
    'SUB2API_CONCURRENCY',
    'SUB2API_PRIORITY',
    'SUB2API_GROUP_IDS',
    'SUB2API_AUTO_FILL_RELATED_MODELS',
    'SUB2API_CONFIRM_MIXED_CHANNEL_RISK',
    'SUB2API_OPENAI_OAUTH_RESPONSES_WEBSOCKET_V2_MODE',
  ]

  if (!hasAnyDefinedEnv(relevantEnvNames)) {
    return undefined
  }

  return {
    baseUrl: process.env.SUB2API_BASE_URL,
    apiKey: process.env.SUB2API_API_KEY,
    bearerToken: process.env.SUB2API_BEARER_TOKEN,
    email: process.env.SUB2API_EMAIL,
    password: process.env.SUB2API_PASSWORD,
    loginPath: process.env.SUB2API_LOGIN_PATH,
    refreshTokenPath: process.env.SUB2API_REFRESH_TOKEN_PATH,
    accountsPath: process.env.SUB2API_ACCOUNTS_PATH,
    clientId: process.env.SUB2API_CLIENT_ID,
    proxyId: parseOptionalNumber(process.env.SUB2API_PROXY_ID),
    concurrency: parseOptionalNumber(process.env.SUB2API_CONCURRENCY),
    priority: parseOptionalNumber(process.env.SUB2API_PRIORITY),
    groupIds: parseIntegerList(process.env.SUB2API_GROUP_IDS),
    autoFillRelatedModels: hasEnvValue(
      process.env.SUB2API_AUTO_FILL_RELATED_MODELS,
    )
      ? parseBoolean(process.env.SUB2API_AUTO_FILL_RELATED_MODELS, false)
      : undefined,
    confirmMixedChannelRisk: hasEnvValue(
      process.env.SUB2API_CONFIRM_MIXED_CHANNEL_RISK,
    )
      ? parseBoolean(process.env.SUB2API_CONFIRM_MIXED_CHANNEL_RISK, false)
      : undefined,
    openaiOAuthResponsesWebSocketV2Mode: parseSub2ApiOpenAIWSMode(
      process.env.SUB2API_OPENAI_OAUTH_RESPONSES_WEBSOCKET_V2_MODE,
    ),
  }
}

function buildChatGPTTeamTrialConfig(): ChatGPTTeamTrialConfig | undefined {
  const relevantEnvNames = [
    'CHATGPT_TEAM_TRIAL_BILLING_NAME',
    'CHATGPT_TEAM_TRIAL_BILLING_COUNTRY',
    'CHATGPT_TEAM_TRIAL_BILLING_ADDRESS_LINE1',
    'CHATGPT_TEAM_TRIAL_BILLING_ADDRESS_LINE2',
    'CHATGPT_TEAM_TRIAL_BILLING_CITY',
    'CHATGPT_TEAM_TRIAL_BILLING_STATE',
    'CHATGPT_TEAM_TRIAL_BILLING_POSTAL_CODE',
    'CHATGPT_TEAM_TRIAL_GOPAY_COUNTRY_CODE',
    'CHATGPT_TEAM_TRIAL_GOPAY_PHONE_NUMBER',
    'CHATGPT_TEAM_TRIAL_GOPAY_PIN',
    'CHATGPT_TEAM_TRIAL_GOPAY_AUTHORIZATION_TIMEOUT_MS',
  ]

  if (!hasAnyDefinedEnv(relevantEnvNames)) {
    return undefined
  }

  return {
    ...(hasAnyDefinedEnv([
      'CHATGPT_TEAM_TRIAL_BILLING_NAME',
      'CHATGPT_TEAM_TRIAL_BILLING_COUNTRY',
      'CHATGPT_TEAM_TRIAL_BILLING_ADDRESS_LINE1',
      'CHATGPT_TEAM_TRIAL_BILLING_ADDRESS_LINE2',
      'CHATGPT_TEAM_TRIAL_BILLING_CITY',
      'CHATGPT_TEAM_TRIAL_BILLING_STATE',
      'CHATGPT_TEAM_TRIAL_BILLING_POSTAL_CODE',
    ])
      ? {
          billingAddress: {
            name: process.env.CHATGPT_TEAM_TRIAL_BILLING_NAME,
            country: process.env.CHATGPT_TEAM_TRIAL_BILLING_COUNTRY,
            line1: process.env.CHATGPT_TEAM_TRIAL_BILLING_ADDRESS_LINE1,
            line2: process.env.CHATGPT_TEAM_TRIAL_BILLING_ADDRESS_LINE2,
            city: process.env.CHATGPT_TEAM_TRIAL_BILLING_CITY,
            state: process.env.CHATGPT_TEAM_TRIAL_BILLING_STATE,
            postalCode: process.env.CHATGPT_TEAM_TRIAL_BILLING_POSTAL_CODE,
          },
        }
      : {}),
    ...(hasAnyDefinedEnv([
      'CHATGPT_TEAM_TRIAL_GOPAY_COUNTRY_CODE',
      'CHATGPT_TEAM_TRIAL_GOPAY_PHONE_NUMBER',
      'CHATGPT_TEAM_TRIAL_GOPAY_PIN',
      'CHATGPT_TEAM_TRIAL_GOPAY_AUTHORIZATION_TIMEOUT_MS',
    ])
      ? {
          gopay: {
            countryCode: process.env.CHATGPT_TEAM_TRIAL_GOPAY_COUNTRY_CODE,
            phoneNumber: process.env.CHATGPT_TEAM_TRIAL_GOPAY_PHONE_NUMBER,
            pin: process.env.CHATGPT_TEAM_TRIAL_GOPAY_PIN,
            authorizationTimeoutMs: parseOptionalNumber(
              process.env.CHATGPT_TEAM_TRIAL_GOPAY_AUTHORIZATION_TIMEOUT_MS,
            ),
          },
        }
      : {}),
  }
}

function parseSub2ApiOpenAIWSMode(
  value: string | undefined,
): Sub2ApiConfig['openaiOAuthResponsesWebSocketV2Mode'] {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'off' ||
    normalized === 'ctx_pool' ||
    normalized === 'passthrough'
  ) {
    return normalized
  }
  return undefined
}

function mergeDeep<T>(base: T, patch?: PartialDeep<T>): T {
  if (!patch) return base
  const output = { ...base } as Record<string, unknown>

  for (const [key, value] of Object.entries(patch)) {
    const current = output[key]
    if (isObject(current) && isObject(value)) {
      output[key] = mergeDeep(current, value)
    } else if (value !== undefined) {
      output[key] = value
    }
  }

  return output as T
}

const workspaceRoot = resolveWorkspaceRoot(fileURLToPath(import.meta.url))

function buildDefaultConfig(): AppConfig {
  loadWorkspaceEnv()
  const exchangeMailFlowCatchAll = process.env.EXCHANGE_CATCH_ALL_PREFIX
    ? {
        prefix: process.env.EXCHANGE_CATCH_ALL_PREFIX,
      }
    : undefined
  const codeyAppConfig = buildCodeyAppConfig()
  const sub2ApiConfig = buildSub2ApiConfig()
  const chatgptTeamTrialConfig = buildChatGPTTeamTrialConfig()
  const verificationConfig =
    parseVerificationProviderConfigKind(process.env.VERIFICATION_PROVIDER) ||
    codeyAppConfig
      ? {
          provider: parseVerificationProviderConfigKind(
            process.env.VERIFICATION_PROVIDER,
          ),
          app: codeyAppConfig,
        }
      : undefined
  const codexConfig: CodexOAuthConfig = {
    authorizeUrl:
      process.env.CODEX_AUTHORIZE_URL || defaultCodexOAuthConfig.authorizeUrl,
    tokenUrl: process.env.CODEX_TOKEN_URL || defaultCodexOAuthConfig.tokenUrl,
    clientId: process.env.CODEX_CLIENT_ID || defaultCodexOAuthConfig.clientId,
    clientSecret: process.env.CODEX_CLIENT_SECRET,
    scope: process.env.CODEX_SCOPE || defaultCodexOAuthConfig.scope,
    redirectHost:
      process.env.CODEX_REDIRECT_HOST || defaultCodexOAuthConfig.redirectHost,
    redirectPort: process.env.CODEX_REDIRECT_PORT
      ? Number(process.env.CODEX_REDIRECT_PORT)
      : defaultCodexOAuthConfig.redirectPort,
    redirectPath:
      process.env.CODEX_REDIRECT_PATH || defaultCodexOAuthConfig.redirectPath,
  }

  return {
    rootDir: workspaceRoot,
    artifactsDir: path.join(workspaceRoot, 'artifacts'),
    browser: {
      headless: parseBoolean(process.env.HEADLESS, false),
      slowMo: parseNumber(process.env.SLOW_MO, 0),
      defaultTimeoutMs: parseNumber(process.env.DEFAULT_TIMEOUT_MS, 15000),
      navigationTimeoutMs: parseNumber(
        process.env.NAVIGATION_TIMEOUT_MS,
        30000,
      ),
      recordHar: false,
      proxy: resolveProxyConfig(),
    },
    android: {
      appiumServerUrl: process.env.APPIUM_SERVER_URL || 'http://127.0.0.1:4723',
      automationName: process.env.ANDROID_AUTOMATION_NAME || 'UiAutomator2',
      deviceName: process.env.ANDROID_DEVICE_NAME || 'Android',
      platformVersion: process.env.ANDROID_PLATFORM_VERSION,
      udid: process.env.ANDROID_UDID,
      appPackage: process.env.ANDROID_APP_PACKAGE,
      appActivity: process.env.ANDROID_APP_ACTIVITY,
      noReset: hasEnvValue(process.env.ANDROID_NO_RESET)
        ? parseBoolean(process.env.ANDROID_NO_RESET, true)
        : true,
    },
    openai: {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://openai.com',
      chatgptUrl: process.env.CHATGPT_URL || 'https://chatgpt.com',
    },
    exchange:
      process.env.EXCHANGE_TENANT_ID &&
      process.env.EXCHANGE_CLIENT_ID &&
      process.env.EXCHANGE_CLIENT_SECRET
        ? {
            mailbox: process.env.EXCHANGE_MAILBOX,
            auth: {
              mode: 'client_credentials',
              tenantId: process.env.EXCHANGE_TENANT_ID,
              clientId: process.env.EXCHANGE_CLIENT_ID,
              clientSecret: process.env.EXCHANGE_CLIENT_SECRET,
            },
            mailFlow: exchangeMailFlowCatchAll
              ? {
                  catchAll: exchangeMailFlowCatchAll,
                }
              : undefined,
          }
        : undefined,
    verification: verificationConfig,
    app: codeyAppConfig,
    codex: codexConfig,
    sub2api: sub2ApiConfig,
    chatgptTeamTrial: chatgptTeamTrialConfig,
  }
}

export const defaultConfig: AppConfig = buildDefaultConfig()

let runtimeConfig: CliRuntimeConfig = buildDefaultConfig()

export function loadConfigFile(
  configFile?: string,
): PartialDeep<AppConfig> | undefined {
  if (!configFile) return undefined
  const resolved = path.isAbsolute(configFile)
    ? configFile
    : path.resolve(workspaceRoot, configFile)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`)
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8')) as PartialDeep<AppConfig>
}

export function resolveConfig(
  options: {
    configFile?: string
    profile?: string
    overrides?: PartialDeep<AppConfig>
    command?: string
  } = {},
): CliRuntimeConfig {
  const fromEnv = buildDefaultConfig()
  const fromFile = loadConfigFile(options.configFile)
  const merged = mergeDeep(mergeDeep(fromEnv, fromFile), options.overrides)
  return {
    ...merged,
    command: options.command,
    profile: options.profile,
    configFile: options.configFile,
  }
}

export function setRuntimeConfig(config: CliRuntimeConfig): void {
  runtimeConfig = config
}

export function getRuntimeConfig(): CliRuntimeConfig {
  return runtimeConfig
}
