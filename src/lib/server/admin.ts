import "@tanstack/react-start/server-only";
import { and, count, eq, gt, isNull, or, desc, asc } from "drizzle-orm";
import { getAppEnv } from "./env";
import {
  adminNotifications,
  flowAppRequests as flowAppRequestsTable,
  users,
} from "./db/schema";
import { getDb } from "./db/client";
import { listRecentDeviceChallenges } from "./device-auth";
import { listAdminIdentitySummaries } from "./identities";
import { getOidcSigningKeyStatus } from "./oidc/jwks";
import { listRecentVerificationActivity } from "./verification";
import { createId } from "./security";

interface ConfigStatusItem {
  id: string;
  key: string;
  label: string;
  description?: string;
  status: string;
  detail: string;
}

function boolStatus(value: boolean, success = "configured") {
  return value ? success : "missing";
}

async function listConfigStatus(identityState: Awaited<ReturnType<typeof listAdminIdentitySummaries>>): Promise<ConfigStatusItem[]> {
  const env = getAppEnv();
  const db = getDb();
  const [userCountResult, adminCountResult, oidcSigningKeyStatus] = await Promise.all([
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(users).where(eq(users.role, "ADMIN")),
    getOidcSigningKeyStatus(),
  ]);
  const userCount = Number(userCountResult[0]?.count ?? 0);
  const adminCount = Number(adminCountResult[0]?.count ?? 0);

  const exchangeConfigured = Boolean(
    process.env.EXCHANGE_TENANT_ID &&
      process.env.EXCHANGE_CLIENT_ID &&
      process.env.EXCHANGE_CLIENT_SECRET,
  );
  const codexEnvOverridesConfigured = Boolean(
    process.env.CODEX_AUTHORIZE_URL ||
      process.env.CODEX_TOKEN_URL ||
      process.env.CODEX_CLIENT_ID ||
      process.env.CODEX_CLIENT_SECRET ||
      process.env.CODEX_SCOPE ||
      process.env.CODEX_REDIRECT_HOST ||
      process.env.CODEX_REDIRECT_PORT ||
      process.env.CODEX_REDIRECT_PATH,
  );

  return [
    {
      id: "github-browser-oauth",
      key: "githubBrowserOAuth",
      label: "GitHub browser OAuth",
      status: boolStatus(Boolean(env.githubClientId && env.githubClientSecret)),
      detail:
        env.githubClientId && env.githubClientSecret
          ? "Browser admin sign-in is configured for GitHub OAuth."
          : "Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to enable browser admin sign-in.",
    },
    {
      id: "admin-policy",
      key: "adminPolicy",
      label: "Admin access policy",
      status:
        env.adminGitHubLogins.length > 0
          ? "configured"
          : adminCount > 0
            ? "bootstrap"
            : "missing",
      detail:
        env.adminGitHubLogins.length > 0
          ? `Admin allowlist is active for ${env.adminGitHubLogins.length} GitHub login(s).`
          : adminCount > 0
            ? `No explicit allowlist is set; ${adminCount} admin account(s) currently exist in the app database.`
            : `No admin allowlist or bootstrapped admin account found. Current user count: ${userCount}.`,
    },
    {
      id: "identity-store",
      key: "identityStore",
      label: "Saved identity store",
      status: identityState.storeStatus.status,
      detail: identityState.storeStatus.detail,
    },
    {
      id: "exchange-client-credentials",
      key: "exchangeClientCredentials",
      label: "Exchange client credentials",
      description: "Status for the existing Exchange client_credentials flow used by flows.",
      status: boolStatus(exchangeConfigured),
      detail: exchangeConfigured
        ? "Exchange tenant/client credentials are present for flow automation."
        : "Exchange client_credentials are not configured in the current environment.",
    },
    {
      id: "codex-oauth",
      key: "codexOAuth",
      label: "Codex OAuth",
      description: "Optional local OAuth setup used by the existing simplified CLI authorization flow.",
      status: "ready",
      detail: codexEnvOverridesConfigured
        ? "Codex OAuth is using local CODEX_* overrides for the OpenAI OAuth flow."
        : "Codex OAuth uses built-in OpenAI defaults; set CODEX_* only if you need to override them.",
    },
    {
      id: "oidc-signing-keys",
      key: "oidcSigningKeys",
      label: "OIDC signing keys",
      description: "Signing keys are stored in Postgres, cached in-memory, and rotated automatically.",
      status: oidcSigningKeyStatus.status,
      detail: oidcSigningKeyStatus.detail,
    },
    {
      id: "flow-app-request-queue",
      key: "flowAppRequestQueue",
      label: "Flow app request queue",
      status: "ready",
      detail: "Admins can queue auto-add-account requests for GitHub Actions flow apps from this control plane.",
    },
  ];
}

export async function listAdminDashboardData() {
  const [
    notifications,
    deviceChallenges,
    verification,
    identityState,
    flowAppRequests,
  ] = await Promise.all([
    getDb().query.adminNotifications.findMany({
      orderBy: [desc(adminNotifications.createdAt)],
      limit: 20,
    }),
    listRecentDeviceChallenges(),
    listRecentVerificationActivity(),
    listAdminIdentitySummaries(),
    getDb().query.flowAppRequests.findMany({
      orderBy: [desc(flowAppRequestsTable.createdAt)],
      limit: 20,
    }),
  ]);

  const configStatus = await listConfigStatus(identityState);

  return {
    notifications,
    deviceChallenges: deviceChallenges.map((challenge) => ({
      ...challenge,
      target: challenge.requestedBy || challenge.user?.githubLogin || null,
      updatedAt:
        challenge.lastPolledAt ||
        challenge.consumedAt ||
        challenge.approvedAt ||
        challenge.deniedAt ||
        challenge.createdAt,
    })),
    verification,
    identitySummaries: identityState.summaries,
    flowAppRequests,
    configStatus,
  };
}

export async function createAdminNotification(params: {
  title: string;
  body: string;
  flowType?: string;
  target?: string;
}) {
  const [notification] = await getDb()
    .insert(adminNotifications)
    .values({
      id: createId(),
      title: params.title,
      body: params.body,
      flowType: params.flowType,
      target: params.target,
    })
    .returning();

  return notification;
}

export async function createFlowAppRequest(params: {
  appName: string;
  flowType?: string;
  requestedBy?: string;
  requestedIdentity?: string;
  notes?: string;
}) {
  const [request] = await getDb()
    .insert(flowAppRequestsTable)
    .values({
      id: createId(),
      appName: params.appName,
      flowType: params.flowType,
      requestedBy: params.requestedBy,
      requestedIdentity: params.requestedIdentity,
      notes: params.notes,
    })
    .returning();

  return request;
}

export async function listCliNotifications(params: {
  target?: string;
  after?: Date;
}) {
  const targetFilter = params.target
    ? or(
        isNull(adminNotifications.target),
        eq(adminNotifications.target, "all"),
        eq(adminNotifications.target, params.target),
      )
    : or(
        isNull(adminNotifications.target),
        eq(adminNotifications.target, "all"),
      );

  return getDb().query.adminNotifications.findMany({
    where:
      params.after && targetFilter
        ? and(targetFilter, gt(adminNotifications.createdAt, params.after))
        : targetFilter,
    orderBy: [asc(adminNotifications.createdAt)],
    limit: 50,
  });
}
