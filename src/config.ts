import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export interface BrowserCliConfig {
  headless: boolean;
  slowMo: number;
  defaultTimeoutMs: number;
  navigationTimeoutMs: number;
  browsersPath: string;
}

export interface OpenAIFlowConfig {
  baseUrl: string;
  chatgptUrl: string;
}

export interface ExchangeAuthConfig {
  mode: 'basic';
  username: string;
  password: string;
}

export interface ExchangeConfig {
  endpoint: string;
  auth: ExchangeAuthConfig;
  mailbox?: string;
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

export const defaultConfig: AppConfig = {
  rootDir,
  artifactsDir: path.join(rootDir, 'artifacts'),
  browser: {
    headless: parseBoolean(process.env.HEADLESS, false),
    slowMo: parseNumber(process.env.SLOW_MO, 0),
    defaultTimeoutMs: parseNumber(process.env.DEFAULT_TIMEOUT_MS, 15000),
    navigationTimeoutMs: parseNumber(process.env.NAVIGATION_TIMEOUT_MS, 30000),
    browsersPath:
      process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(rootDir, '.playwright-browsers'),
  },
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL || 'https://openai.com',
    chatgptUrl: process.env.CHATGPT_URL || 'https://chatgpt.com',
  },
  exchange:
    process.env.EXCHANGE_ENDPOINT && process.env.EXCHANGE_USERNAME && process.env.EXCHANGE_PASSWORD
      ? {
        endpoint: process.env.EXCHANGE_ENDPOINT,
        mailbox: process.env.EXCHANGE_MAILBOX,
        auth: {
          mode: 'basic',
          username: process.env.EXCHANGE_USERNAME,
          password: process.env.EXCHANGE_PASSWORD,
        },
      }
      : undefined,
};

let runtimeConfig: AppConfig = defaultConfig;

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
  const fromFile = loadConfigFile(options.configFile);
  const merged = mergeDeep(mergeDeep(defaultConfig, fromFile), options.overrides);
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
