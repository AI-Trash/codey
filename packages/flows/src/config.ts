import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadWorkspaceEnv } from './utils/env'
import { resolveWorkspaceRoot } from './utils/workspace-root'

export interface BrowserCliConfig {
  headless: boolean
  slowMo: number
  defaultTimeoutMs: number
  navigationTimeoutMs: number
  recordHar: boolean
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

export interface AxonHubAdminConfig {
  baseUrl?: string
  email?: string
  password?: string
  projectId?: string
  graphqlPath?: string
}

export interface CodexChannelConfig {
  name?: string
  baseUrl?: string
  tags?: string[]
  supportedModels?: string[]
  manualModels?: string[]
  defaultTestModel?: string
}

export interface AppConfig {
  rootDir: string
  artifactsDir: string
  browser: BrowserCliConfig
  openai: OpenAIFlowConfig
  exchange?: ExchangeConfig
  verification?: VerificationConfig
  app?: AppAuthConfig
  codex?: CodexOAuthConfig
  axonHub?: AxonHubAdminConfig
  codexChannel?: CodexChannelConfig
}

export interface CliRuntimeConfig extends AppConfig {
  command?: string
  profile?: string
  configFile?: string
}

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K]
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function parseNumber(value: string | undefined, fallback: number): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const list = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return list.length ? list : undefined
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
  const codexConfig =
    process.env.CODEX_AUTHORIZE_URL ||
    process.env.CODEX_TOKEN_URL ||
    process.env.CODEX_CLIENT_ID ||
    process.env.CODEX_CLIENT_SECRET ||
    process.env.CODEX_SCOPE ||
    process.env.CODEX_REDIRECT_HOST ||
    process.env.CODEX_REDIRECT_PORT ||
    process.env.CODEX_REDIRECT_PATH
      ? {
          authorizeUrl: process.env.CODEX_AUTHORIZE_URL,
          tokenUrl: process.env.CODEX_TOKEN_URL,
          clientId: process.env.CODEX_CLIENT_ID,
          clientSecret: process.env.CODEX_CLIENT_SECRET,
          scope: process.env.CODEX_SCOPE,
          redirectHost: process.env.CODEX_REDIRECT_HOST,
          redirectPort: process.env.CODEX_REDIRECT_PORT
            ? Number(process.env.CODEX_REDIRECT_PORT)
            : undefined,
          redirectPath: process.env.CODEX_REDIRECT_PATH,
        }
      : undefined
  const axonHubConfig =
    process.env.AXONHUB_BASE_URL ||
    process.env.AXONHUB_ADMIN_EMAIL ||
    process.env.AXONHUB_ADMIN_PASSWORD ||
    process.env.AXONHUB_PROJECT_ID ||
    process.env.AXONHUB_GRAPHQL_PATH
      ? {
          baseUrl: process.env.AXONHUB_BASE_URL,
          email: process.env.AXONHUB_ADMIN_EMAIL,
          password: process.env.AXONHUB_ADMIN_PASSWORD,
          projectId: process.env.AXONHUB_PROJECT_ID,
          graphqlPath: process.env.AXONHUB_GRAPHQL_PATH,
        }
      : undefined
  const codexChannelConfig =
    process.env.CODEX_CHANNEL_NAME ||
    process.env.CODEX_CHANNEL_BASE_URL ||
    process.env.CODEX_CHANNEL_TAGS ||
    process.env.CODEX_CHANNEL_SUPPORTED_MODELS ||
    process.env.CODEX_CHANNEL_MANUAL_MODELS ||
    process.env.CODEX_CHANNEL_DEFAULT_TEST_MODEL
      ? {
          name: process.env.CODEX_CHANNEL_NAME,
          baseUrl: process.env.CODEX_CHANNEL_BASE_URL,
          tags: parseList(process.env.CODEX_CHANNEL_TAGS),
          supportedModels: parseList(
            process.env.CODEX_CHANNEL_SUPPORTED_MODELS,
          ),
          manualModels: parseList(process.env.CODEX_CHANNEL_MANUAL_MODELS),
          defaultTestModel: process.env.CODEX_CHANNEL_DEFAULT_TEST_MODEL,
        }
      : undefined

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
    axonHub: axonHubConfig,
    codexChannel: codexChannelConfig,
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
