import "@tanstack/react-start/server-only";

import { DEFAULT_OAUTH_SUPPORTED_SCOPES } from "./oauth-scopes";

export interface AppEnv {
  databaseUrl: string;
  sessionCookieName: string;
  sessionTtlDays: number;
  adminGitHubLogins: string[];
  flowAppApiKey?: string;
  flowAppApiKeyHeader: string;
  verificationApiKey?: string;
  verificationApiKeyHeader: string;
  githubClientId?: string;
  githubClientSecret?: string;
  githubAuthorizeUrl: string;
  githubTokenUrl: string;
  githubUserUrl: string;
  githubScope: string;
  appBaseUrl?: string;
  verificationMailbox?: string;
  verificationEmailPrefix?: string;
  verificationDomain?: string;
  verificationReservationTtlMinutes: number;
  deviceChallengeTtlMinutes: number;
  cloudflareWebhookSecret?: string;
  cloudflareSignatureHeader: string;
  cloudflareTimestampHeader: string;
  oauthIssuer?: string;
  oauthJwks?: {
    keys: Array<Record<string, unknown>>;
  };
  oauthClientSecretEncryptionKey?: string;
  oauthAccessTokenTtlSeconds: number;
  oauthDeviceCodeTtlSeconds: number;
  oauthDefaultResourceIndicator?: string;
  oauthSupportedScopes: string[];
}

function readDatabaseUrl(value: string | undefined): string {
  const databaseUrl = value?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required and must use a postgres:// or postgresql:// URL.",
    );
  }

  let protocol: string;
  try {
    protocol = new URL(databaseUrl).protocol;
  } catch {
    throw new Error(
      "DATABASE_URL must be a valid postgres:// or postgresql:// URL.",
    );
  }

  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error(
      "DATABASE_URL must use PostgreSQL. SQLite and other database engines are not supported.",
    );
  }

  return databaseUrl;
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function readOptionalBase64Key(
  value: string | undefined,
  envName: string,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(normalized, "base64");
  } catch {
    throw new Error(`${envName} must be valid base64.`);
  }

  if (decoded.length !== 32) {
    throw new Error(`${envName} must decode to exactly 32 bytes.`);
  }

  return normalized;
}

function readOptionalJsonObject(
  value: string | undefined,
  envName: string,
): { keys: Array<Record<string, unknown>> } | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(`${envName} must be valid JSON.`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("keys" in parsed) ||
    !Array.isArray((parsed as { keys?: unknown }).keys)
  ) {
    throw new Error(`${envName} must be a JWKS object with a keys array.`);
  }

  return parsed as { keys: Array<Record<string, unknown>> };
}

export function getAppEnv(): AppEnv {
  return {
    databaseUrl: readDatabaseUrl(process.env.DATABASE_URL),
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "codey_session",
    sessionTtlDays: readNumber(process.env.SESSION_TTL_DAYS, 14),
    adminGitHubLogins: readList(process.env.ADMIN_GITHUB_LOGINS),
    flowAppApiKey: process.env.FLOW_APP_API_KEY,
    flowAppApiKeyHeader:
      process.env.FLOW_APP_API_KEY_HEADER || "x-codey-flow-app-key",
    verificationApiKey: process.env.VERIFICATION_API_KEY,
    verificationApiKeyHeader:
      process.env.VERIFICATION_API_KEY_HEADER || "x-codey-api-key",
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    githubAuthorizeUrl:
      process.env.GITHUB_AUTHORIZE_URL ||
      "https://github.com/login/oauth/authorize",
    githubTokenUrl:
      process.env.GITHUB_TOKEN_URL ||
      "https://github.com/login/oauth/access_token",
    githubUserUrl: process.env.GITHUB_USER_URL || "https://api.github.com/user",
    githubScope: process.env.GITHUB_SCOPE || "read:user user:email",
    appBaseUrl: process.env.APP_BASE_URL,
    verificationMailbox: process.env.VERIFICATION_MAILBOX,
    verificationEmailPrefix: process.env.VERIFICATION_EMAIL_PREFIX,
    verificationDomain: process.env.VERIFICATION_DOMAIN,
    verificationReservationTtlMinutes: readNumber(
      process.env.VERIFICATION_RESERVATION_TTL_MINUTES,
      15,
    ),
    deviceChallengeTtlMinutes: readNumber(
      process.env.DEVICE_CHALLENGE_TTL_MINUTES,
      15,
    ),
    cloudflareWebhookSecret: process.env.CLOUDFLARE_EMAIL_WEBHOOK_SECRET,
    cloudflareSignatureHeader:
      process.env.CLOUDFLARE_SIGNATURE_HEADER || "x-codey-signature",
    cloudflareTimestampHeader:
      process.env.CLOUDFLARE_TIMESTAMP_HEADER || "x-codey-timestamp",
    oauthIssuer: process.env.OAUTH_ISSUER,
    oauthJwks: readOptionalJsonObject(process.env.OAUTH_JWKS_JSON, "OAUTH_JWKS_JSON"),
    oauthClientSecretEncryptionKey: readOptionalBase64Key(
      process.env.OAUTH_CLIENT_SECRET_ENCRYPTION_KEY,
      "OAUTH_CLIENT_SECRET_ENCRYPTION_KEY",
    ),
    oauthAccessTokenTtlSeconds: readNumber(
      process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      3600,
    ),
    oauthDeviceCodeTtlSeconds: readNumber(
      process.env.OAUTH_DEVICE_CODE_TTL_SECONDS,
      600,
    ),
    oauthDefaultResourceIndicator: process.env.OAUTH_DEFAULT_RESOURCE_INDICATOR,
    oauthSupportedScopes: readList(process.env.OAUTH_SUPPORTED_SCOPES).length
      ? readList(process.env.OAUTH_SUPPORTED_SCOPES)
      : DEFAULT_OAUTH_SUPPORTED_SCOPES,
  };
}
