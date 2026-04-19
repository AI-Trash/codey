import "@tanstack/react-start/server-only";

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db/client";
import { cliConnections } from "./db/schema";
import { createId } from "./security";

const ACTIVE_CONNECTION_STALE_MS = 30_000;
const RECENT_CONNECTION_LIMIT = 20;
const ACTIVE_CONNECTION_LIMIT = 50;

export interface AdminCliConnectionSummary {
  id: string;
  sessionRef: string | null;
  userId: string | null;
  authClientId: string | null;
  cliName: string | null;
  target: string | null;
  userAgent: string | null;
  registeredFlows: string[];
  connectionPath: string;
  status: "active" | "offline";
  connectedAt: string;
  lastSeenAt: string;
  disconnectedAt: string | null;
  githubLogin: string | null;
  email: string | null;
  userLabel: string;
}

function toOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function getActiveCutoff(now = Date.now()) {
  return new Date(now - ACTIVE_CONNECTION_STALE_MS);
}

function getCliConnectionStatus(input: {
  lastSeenAt: Date;
  disconnectedAt?: Date | null;
}): "active" | "offline" {
  if (input.disconnectedAt) {
    return "offline";
  }

  return input.lastSeenAt.getTime() >= getActiveCutoff().getTime()
    ? "active"
    : "offline";
}

function getUserLabel(user: {
  githubLogin?: string | null;
  email?: string | null;
  name?: string | null;
} | null): string {
  if (!user) {
    return "Unknown user";
  }

  return (
    user.name?.trim() ||
    user.githubLogin?.trim() ||
    user.email?.trim() ||
    "Unknown user"
  );
}

function mapSummary(row: Awaited<ReturnType<typeof listRecentCliConnectionRows>>[number]): AdminCliConnectionSummary {
  return {
    id: row.id,
    sessionRef: row.sessionRef,
    userId: row.userId,
    authClientId: row.authClientId,
    cliName: row.cliName,
    target: row.target,
    userAgent: row.userAgent,
    registeredFlows: Array.isArray(row.registeredFlows)
      ? row.registeredFlows.filter((value): value is string => Boolean(value))
      : [],
    connectionPath: row.connectionPath,
    status: getCliConnectionStatus(row),
    connectedAt: row.connectedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    disconnectedAt: row.disconnectedAt?.toISOString() || null,
    githubLogin: row.user?.githubLogin || null,
    email: row.user?.email || null,
    userLabel: getUserLabel(row.user),
  };
}

async function listRecentCliConnectionRows(limit = 100) {
  return getDb().query.cliConnections.findMany({
    with: {
      user: true,
    },
    orderBy: [desc(cliConnections.lastSeenAt)],
    limit,
  });
}

export async function registerCliConnection(input: {
  sessionRef?: string | null;
  userId?: string | null;
  authClientId?: string | null;
  cliName?: string | null;
  target?: string | null;
  userAgent?: string | null;
  registeredFlows?: string[] | null;
  connectionPath: string;
}) {
  const [connection] = await getDb()
    .insert(cliConnections)
    .values({
      id: createId(),
      sessionRef: toOptionalString(input.sessionRef),
      userId: toOptionalString(input.userId),
      authClientId: toOptionalString(input.authClientId),
      cliName: toOptionalString(input.cliName),
      target: toOptionalString(input.target),
      userAgent: toOptionalString(input.userAgent),
      registeredFlows: Array.isArray(input.registeredFlows)
        ? Array.from(
            new Set(
              input.registeredFlows
                .map((value) => toOptionalString(value))
                .filter((value): value is string => Boolean(value)),
            ),
          )
        : [],
      connectionPath: input.connectionPath,
    })
    .returning();

  return connection;
}

export async function touchCliConnection(connectionId: string) {
  await getDb()
    .update(cliConnections)
    .set({
      lastSeenAt: new Date(),
    })
    .where(
      and(
        eq(cliConnections.id, connectionId),
        isNull(cliConnections.disconnectedAt),
      ),
    );
}

export async function markCliConnectionDisconnected(connectionId: string) {
  await getDb()
    .update(cliConnections)
    .set({
      lastSeenAt: new Date(),
      disconnectedAt: new Date(),
    })
    .where(
      and(
        eq(cliConnections.id, connectionId),
        isNull(cliConnections.disconnectedAt),
      ),
    );
}

export async function listAdminCliConnectionState() {
  const activeCutoff = getActiveCutoff();
  const [activeRows, recentRows] = await Promise.all([
    getDb().query.cliConnections.findMany({
      with: {
        user: true,
      },
      where: and(
        isNull(cliConnections.disconnectedAt),
        gt(cliConnections.lastSeenAt, activeCutoff),
      ),
      orderBy: [desc(cliConnections.lastSeenAt)],
      limit: ACTIVE_CONNECTION_LIMIT,
    }),
    listRecentCliConnectionRows(100),
  ]);

  const activeConnections = activeRows.map(mapSummary);
  const activeIds = new Set(activeConnections.map((connection) => connection.id));
  const recentConnections = recentRows
    .map(mapSummary)
    .filter((connection) => !activeIds.has(connection.id))
    .slice(0, RECENT_CONNECTION_LIMIT);

  return {
    snapshotAt: new Date().toISOString(),
    activeConnections,
    recentConnections,
  };
}

export async function getAdminCliConnectionSummaryById(
  connectionId: string,
): Promise<AdminCliConnectionSummary | null> {
  const row = await getDb().query.cliConnections.findFirst({
    with: {
      user: true,
    },
    where: eq(cliConnections.id, connectionId),
  });

  return row ? mapSummary(row) : null;
}
