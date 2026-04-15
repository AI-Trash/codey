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
  redirectPort?: string | boolean;
  projectId?: string;
  channelName?: string;
}

export interface AuthOptions extends CommonOptions {
  flowType?: string;
  cliName?: string;
  scope?: string;
  target?: string;
}

export interface ExchangeOptions extends CommonOptions {
  folderId?: string;
  maxItems?: string | boolean;
  unreadOnly?: string | boolean;
}

const REDACTED = "***redacted***";

function sanitizeText(value: string): string {
  return value
    .replace(
      /\b(Bearer|bearer)\s+[A-Za-z0-9\-._~+/]+=*/g,
      "$1 ***redacted***",
    )
    .replace(
      /([?&](?:code|state|access_token|refresh_token|id_token|token|client_secret|api_key))=([^&\s]+)/gi,
      `$1=${REDACTED}`,
    )
    .replace(
      /\b(code|state|access_token|refresh_token|id_token|token|password|secret|client_secret|api_key)\b\s*[:=]\s*([^\s,;"'}]+)/gi,
      (_match, key) => `${key}=***redacted***`,
    )
    .replace(
      /(["']?)(code|state|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|client[_-]?secret|api[_-]?key)(["']?\s*:\s*["']?)([^"'\s,}]+)/gi,
      (_match, open, key, separator) =>
        `${open}${key}${separator}${REDACTED}`,
    );
}

function sanitizeUrlString(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function sanitizeValue(key: string, current: unknown): unknown {
  if (
    /(?:secret|password|apiKey)s?$/i.test(key) ||
    /^(code|state|accessToken|refreshToken|idToken|token)$/i.test(key)
  ) {
    return REDACTED;
  }

  if (typeof current === "string") {
    if (/authorizationUrl/i.test(key)) {
      return REDACTED;
    }

    if (/^(url|href)$/i.test(key) || key.endsWith("Url")) {
      return sanitizeUrlString(current);
    }

    return sanitizeText(current);
  }

  if (Array.isArray(current)) {
    return current.map((entry) => sanitizeValue(key, entry));
  }

  if (current && typeof current === "object") {
    return Object.fromEntries(
      Object.entries(current).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryKey, entryValue),
      ]),
    );
  }

  return current;
}

export function sanitizeErrorForOutput(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(sanitizeText(message));
}

export function redactForOutput<T>(value: T): T {
  return sanitizeValue("", value) as T;
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
  const message = sanitizeErrorForOutput(error).message;
  console.error(
    JSON.stringify(redactForOutput({ status: "failed", error: message }), null, 2),
  );
  process.exit(1);
}

export function execute(task: Promise<void>): void {
  task.catch(reportError);
}
