import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export interface BrowserCliConfig {
  headless: boolean;
  slowMo: number;
  defaultTimeoutMs: number;
  navigationTimeoutMs: number;
}

export interface OpenAIFlowConfig {
  baseUrl: string;
  chatgptUrl: string;
}

export interface ExchangeAuthConfig {
  mode: 'client_credentials';
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface ExchangeMailFlowCatchAllConfig {
  prefix?: string;
}

export interface ExchangeConfig {
  auth: ExchangeAuthConfig;
  mailbox?: string;
  mailFlow?: {
    catchAll?: ExchangeMailFlowCatchAllConfig;
  };
}

export interface AppConfig {
  rootDir: string;
  artifactsDir: string;
  browser: BrowserCliConfig;
  openai: OpenAIFlowConfig;
  exchange?: ExchangeConfig;
}

export interface CliRuntimeConfig extends AppConfig {
  command?: string;
  profile?: string;
  configFile?: string;
}

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K];
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep<T>(base: T, patch?: PartialDeep<T>): T {
  if (!patch) return base;
  const output = { ...base } as Record<string, unknown>;

  for (const [key, value] of Object.entries(patch)) {
    const current = output[key];
    if (isObject(current) && isObject(value)) {
      output[key] = mergeDeep(current, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }

  return output as T;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function buildDefaultConfig(): AppConfig {
  const exchangeMailFlowCatchAll = process.env.EXCHANGE_CATCH_ALL_PREFIX
    ? {
        prefix: process.env.EXCHANGE_CATCH_ALL_PREFIX,
      }
    : undefined;

  return {
    rootDir,
    artifactsDir: path.join(rootDir, 'artifacts'),
    browser: {
      headless: parseBoolean(process.env.HEADLESS, false),
      slowMo: parseNumber(process.env.SLOW_MO, 0),
      defaultTimeoutMs: parseNumber(process.env.DEFAULT_TIMEOUT_MS, 15000),
      navigationTimeoutMs: parseNumber(process.env.NAVIGATION_TIMEOUT_MS, 30000),
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
  };
}

export const defaultConfig: AppConfig = buildDefaultConfig();

let runtimeConfig: AppConfig = buildDefaultConfig();

export function loadConfigFile(configFile?: string): PartialDeep<AppConfig> | undefined {
  if (!configFile) return undefined;
  const resolved = path.isAbsolute(configFile) ? configFile : path.resolve(process.cwd(), configFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8')) as PartialDeep<AppConfig>;
}

export function resolveConfig(options: {
  configFile?: string;
  profile?: string;
  overrides?: PartialDeep<AppConfig>;
  command?: string;
} = {}): CliRuntimeConfig {
  const fromEnv = buildDefaultConfig();
  const fromFile = loadConfigFile(options.configFile);
  const merged = mergeDeep(mergeDeep(fromEnv, fromFile), options.overrides);
  return {
    ...merged,
    command: options.command,
    profile: options.profile,
    configFile: options.configFile,
  };
}

export function setRuntimeConfig(config: AppConfig): void {
  runtimeConfig = config;
}

export function getRuntimeConfig(): AppConfig {
  return runtimeConfig;
}
