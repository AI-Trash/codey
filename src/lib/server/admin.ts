import "@tanstack/react-start/server-only";
import { and, count, eq, gte, isNull, or, desc, asc } from "drizzle-orm";
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
import { m } from "#/paraglide/messages";

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

async function listConfigStatus(): Promise<ConfigStatusItem[]> {
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
      label: m.server_config_github_oauth_label(),
      status: boolStatus(Boolean(env.githubClientId && env.githubClientSecret)),
      detail:
        env.githubClientId && env.githubClientSecret
          ? m.server_config_github_oauth_ready()
          : m.server_config_github_oauth_missing(),
    },
    {
      id: "admin-policy",
      key: "adminPolicy",
      label: m.server_config_admin_policy_label(),
      status:
        env.adminGitHubLogins.length > 0
          ? "configured"
          : adminCount > 0
            ? "bootstrap"
            : "missing",
      detail:
        env.adminGitHubLogins.length > 0
          ? m.server_config_admin_policy_allowlist({
              count: String(env.adminGitHubLogins.length),
            })
          : adminCount > 0
            ? m.server_config_admin_policy_bootstrap({
                count: String(adminCount),
              })
            : m.server_config_admin_policy_missing({
                count: String(userCount),
              }),
    },
    {
      id: "exchange-client-credentials",
      key: "exchangeClientCredentials",
      label: m.server_config_exchange_label(),
      description: m.server_config_exchange_description(),
      status: boolStatus(exchangeConfigured),
      detail: exchangeConfigured
        ? m.server_config_exchange_ready()
        : m.server_config_exchange_missing(),
    },
    {
      id: "codex-oauth",
      key: "codexOAuth",
      label: m.server_config_codex_label(),
      description: m.server_config_codex_description(),
      status: "ready",
      detail: codexEnvOverridesConfigured
        ? m.server_config_codex_overrides()
        : m.server_config_codex_defaults(),
    },
    {
      id: "oidc-signing-keys",
      key: "oidcSigningKeys",
      label: m.server_config_oidc_label(),
      description: m.server_config_oidc_description(),
      status: oidcSigningKeyStatus.status,
      detail: oidcSigningKeyStatus.detail,
    },
    {
      id: "flow-app-request-queue",
      key: "flowAppRequestQueue",
      label: m.server_config_flow_requests_label(),
      status: "ready",
      detail: m.server_config_flow_requests_detail(),
    },
  ];
}

export async function listAdminDashboardData() {
  const [
    notifications,
    deviceChallenges,
    verification,
    identitySummaries,
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

  const configStatus = await listConfigStatus();

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
    identitySummaries,
    flowAppRequests,
    configStatus,
  };
}

export async function createAdminNotification(params: {
  title: string;
  body: string;
  kind?: string;
  flowType?: string;
  target?: string;
  cliConnectionId?: string;
  payload?: Record<string, unknown>;
}) {
  const [notification] = await getDb()
    .insert(adminNotifications)
    .values({
      id: createId(),
      title: params.title,
      body: params.body,
      kind: params.kind || "message",
      flowType: params.flowType,
      target: params.target,
      cliConnectionId: params.cliConnectionId,
      payload: params.payload,
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
  connectionId?: string;
  after?: Date;
  limit?: number;
  offset?: number;
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
  const connectionFilter = params.connectionId
    ? or(
        isNull(adminNotifications.cliConnectionId),
        eq(adminNotifications.cliConnectionId, params.connectionId),
      )
    : isNull(adminNotifications.cliConnectionId);

  return getDb().query.adminNotifications.findMany({
    where: params.after
      ? and(
          targetFilter,
          connectionFilter,
          gte(adminNotifications.createdAt, params.after),
        )
      : and(targetFilter, connectionFilter),
    orderBy: [asc(adminNotifications.createdAt), asc(adminNotifications.id)],
    limit: params.limit ?? 50,
    offset: params.offset,
  });
}
