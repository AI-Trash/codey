import "@tanstack/react-start/server-only";

export interface AppEnv {
  databaseUrl: string;
  sessionCookieName: string;
  sessionTtlDays: number;
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
  verificationDomain?: string;
  verificationReservationTtlMinutes: number;
  deviceChallengeTtlMinutes: number;
  cloudflareWebhookSecret?: string;
  cloudflareSignatureHeader: string;
  cloudflareTimestampHeader: string;
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getAppEnv(): AppEnv {
  return {
    databaseUrl: process.env.DATABASE_URL || "file:./prisma/dev.db",
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "codey_session",
    sessionTtlDays: readNumber(process.env.SESSION_TTL_DAYS, 14),
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
    appBaseUrl: process.env.APP_URL || process.env.APP_BASE_URL,
    verificationMailbox: process.env.VERIFICATION_MAILBOX,
    verificationDomain:
      process.env.VERIFICATION_EMAIL_DOMAIN || process.env.VERIFICATION_DOMAIN,
    verificationReservationTtlMinutes: readNumber(
      process.env.VERIFICATION_RESERVATION_TTL_MINUTES,
      15,
    ),
    deviceChallengeTtlMinutes: readNumber(
      process.env.DEVICE_CHALLENGE_TTL_MINUTES,
      15,
    ),
    cloudflareWebhookSecret:
      process.env.CLOUDFLARE_EMAIL_INGEST_SECRET ||
      process.env.CLOUDFLARE_EMAIL_WEBHOOK_SECRET,
    cloudflareSignatureHeader:
      process.env.CLOUDFLARE_SIGNATURE_HEADER || "x-codey-signature",
    cloudflareTimestampHeader:
      process.env.CLOUDFLARE_TIMESTAMP_HEADER || "x-codey-timestamp",
  };
}
