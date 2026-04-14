import {
  resolveConfig,
  setRuntimeConfig,
  type CliRuntimeConfig,
} from "../../config";

export interface CommonOptions {
  config?: string;
  profile?: string;
  headless?: string | boolean;
  slowMo?: string | boolean;
  har?: string | boolean;
}

export interface FlowOptions extends CommonOptions {
  waitMs?: string | boolean;
  verificationTimeoutMs?: string | boolean;
  pollIntervalMs?: string | boolean;
  password?: string;
  createPasskey?: string | boolean;
  sameSessionPasskeyCheck?: string | boolean;
  identityId?: string;
  email?: string;
  target?: string;
}

export interface AuthOptions extends CommonOptions {
  flowType?: string;
  cliName?: string;
  scope?: string;
  target?: string;
  redirectPort?: string | boolean;
  openBrowser?: string | boolean;
}

export interface ExchangeOptions extends CommonOptions {
  folderId?: string;
  maxItems?: string | boolean;
  unreadOnly?: string | boolean;
}

export function redactForOutput<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, current) => {
      if (typeof current === "string" && /secret|password/i.test(key))
        return "***redacted***";
      return current;
    }),
  ) as T;
}

export function parseBooleanFlag(
  value: string | boolean | undefined,
  fallback?: boolean,
): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function parseNumberFlag(
  value: string | boolean | undefined,
  fallback?: number,
): number | undefined {
  if (typeof value !== "string") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function buildRuntimeConfig(
  command: string,
  options: CommonOptions,
): CliRuntimeConfig {
  return resolveConfig({
    command,
    configFile: options.config,
    profile: options.profile,
    overrides: {
      browser: {
        headless: parseBooleanFlag(options.headless),
        slowMo: parseNumberFlag(options.slowMo),
        recordHar: parseBooleanFlag(options.har),
      },
    },
  });
}

export function prepareRuntimeConfig(
  command: string,
  options: CommonOptions,
): CliRuntimeConfig {
  const config = buildRuntimeConfig(command, options);
  setRuntimeConfig(config);
  return config;
}

export function reportError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "failed", error: message }, null, 2));
  process.exit(1);
}

export function execute(task: Promise<void>): void {
  task.catch(reportError);
}
