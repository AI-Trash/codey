import "@tanstack/react-start/server-only";
import { getAppEnv } from "./env";
import { prisma } from "./prisma";
import { listRecentDeviceChallenges } from "./device-auth";
import { listAdminIdentitySummaries } from "./identities";
import { listRecentVerificationActivity } from "./verification";

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
  const [userCount, adminCount] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "ADMIN" } }),
  ]);

  const exchangeConfigured = Boolean(
    process.env.EXCHANGE_TENANT_ID &&
      process.env.EXCHANGE_CLIENT_ID &&
      process.env.EXCHANGE_CLIENT_SECRET,
  );
  const codexConfigured = Boolean(
    process.env.CODEX_AUTHORIZE_URL &&
      process.env.CODEX_TOKEN_URL &&
      process.env.CODEX_CLIENT_ID,
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
            ? `No explicit allowlist is set; ${adminCount} admin account(s) currently exist in Prisma.`
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
      status: boolStatus(codexConfigured, "ready"),
      detail: codexConfigured
        ? "Codex authorize/token URLs and client ID are configured."
        : "CODEX_AUTHORIZE_URL, CODEX_TOKEN_URL, and CODEX_CLIENT_ID are not all present.",
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
    prisma.adminNotification.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    listRecentDeviceChallenges(),
    listRecentVerificationActivity(),
    listAdminIdentitySummaries(),
    prisma.flowAppRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
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
  return prisma.adminNotification.create({
    data: params,
  });
}

export async function createFlowAppRequest(params: {
  appName: string;
  flowType?: string;
  requestedBy?: string;
  requestedIdentity?: string;
  notes?: string;
}) {
  return prisma.flowAppRequest.create({
    data: params,
  });
}

export async function listCliNotifications(params: {
  target?: string;
  after?: Date;
}) {
  const filters = [] as Array<{
    target?: string | null;
    createdAt?: { gt: Date };
  }>;

  filters.push({ target: null });
  filters.push({ target: "all" });
  if (params.target) {
    filters.push({ target: params.target });
  }

  return prisma.adminNotification.findMany({
    where: {
      OR: filters.map((filter) => ({
        target: filter.target,
        ...(params.after ? { createdAt: { gt: params.after } } : {}),
      })),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}
