import "@tanstack/react-start/server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import {
  managedIdentitySessions,
  type ManagedIdentitySessionStatus,
} from "./db/schema";
import { createId } from "./security";

export interface AdminManagedSessionSummary {
  id: string;
  identityId: string;
  identityLabel: string;
  email: string;
  authMode: string;
  flowType: string;
  accountId: string | null;
  sessionId: string | null;
  status: string;
  lastRefreshAt: string | null;
  expiresAt: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  sessionData: Record<string, unknown>;
}

function parseOptionalDate(value?: string | null): Date | null {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapSessionStatus(
  status: ManagedIdentitySessionStatus,
  expiresAt?: Date | null,
): string {
  if (status === "REVOKED") {
    return "revoked";
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return "expired";
  }

  return "active";
}

function buildManagedSessionSummary(row: {
  id: string;
  identityId: string;
  email: string;
  authMode: string;
  flowType: string;
  accountId: string | null;
  sessionId: string | null;
  status: ManagedIdentitySessionStatus;
  lastRefreshAt: Date | null;
  expiresAt: Date | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
  sessionData: Record<string, unknown>;
  identity?: {
    label: string | null;
    email: string;
  } | null;
}): AdminManagedSessionSummary {
  return {
    id: row.id,
    identityId: row.identityId,
    identityLabel: row.identity?.label || row.identity?.email || row.email,
    email: row.email,
    authMode: row.authMode,
    flowType: row.flowType,
    accountId: row.accountId,
    sessionId: row.sessionId,
    status: mapSessionStatus(row.status, row.expiresAt),
    lastRefreshAt: row.lastRefreshAt?.toISOString() || null,
    expiresAt: row.expiresAt?.toISOString() || null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sessionData: row.sessionData,
  } satisfies AdminManagedSessionSummary;
}

export async function listAdminManagedSessionSummaries(): Promise<
  AdminManagedSessionSummary[]
> {
  const rows = await getDb().query.managedIdentitySessions.findMany({
    with: {
      identity: {
        columns: {
          label: true,
          email: true,
        },
      },
    },
    orderBy: [desc(managedIdentitySessions.lastSeenAt)],
  });

  return rows.map((row) => buildManagedSessionSummary(row));
}

export async function findAdminManagedSessionSummary(id: string) {
  const row = await getDb().query.managedIdentitySessions.findFirst({
    where: eq(managedIdentitySessions.id, id),
    with: {
      identity: {
        columns: {
          label: true,
          email: true,
        },
      },
    },
  });

  return row ? buildManagedSessionSummary(row) : null;
}

export async function syncManagedSession(params: {
  identityId: string;
  email: string;
  authMode: string;
  flowType: string;
  accountId?: string | null;
  sessionId?: string | null;
  lastRefreshAt?: string | null;
  expiresAt?: string | null;
  sessionData: Record<string, unknown>;
}) {
  const identityId = params.identityId.trim();
  const email = params.email.trim().toLowerCase();
  const authMode = params.authMode.trim() || "chatgpt";
  const flowType = params.flowType.trim();
  const accountId = params.accountId?.trim() || null;
  const sessionId = params.sessionId?.trim() || null;
  const lastRefreshAt = parseOptionalDate(params.lastRefreshAt);
  const expiresAt = parseOptionalDate(params.expiresAt);
  const seenAt = new Date();
  const existing = await getDb().query.managedIdentitySessions.findFirst({
    where: eq(managedIdentitySessions.identityId, identityId),
  });

  if (existing) {
    const [record] = await getDb()
      .update(managedIdentitySessions)
      .set({
        email,
        authMode,
        flowType,
        accountId,
        sessionId,
        sessionData: params.sessionData,
        status: "ACTIVE",
        lastRefreshAt,
        expiresAt,
        lastSeenAt: seenAt,
        updatedAt: seenAt,
      })
      .where(eq(managedIdentitySessions.identityId, identityId))
      .returning();

    if (record) {
      return record;
    }
  }

  const [created] = await getDb()
    .insert(managedIdentitySessions)
    .values({
      id: createId(),
      identityId,
      email,
      authMode,
      flowType,
      accountId,
      sessionId,
      sessionData: params.sessionData,
      status: "ACTIVE",
      lastRefreshAt,
      expiresAt,
      lastSeenAt: seenAt,
      createdAt: seenAt,
      updatedAt: seenAt,
    })
    .returning();

  if (!created) {
    throw new Error("Unable to sync managed session");
  }

  return created;
}

export async function updateManagedSessionStatus(params: {
  id: string;
  status: ManagedIdentitySessionStatus;
}) {
  const existing = await getDb().query.managedIdentitySessions.findFirst({
    where: eq(managedIdentitySessions.id, params.id),
  });
  if (!existing) {
    return null;
  }

  const [record] = await getDb()
    .update(managedIdentitySessions)
    .set({
      status: params.status,
      updatedAt: new Date(),
    })
    .where(eq(managedIdentitySessions.id, params.id))
    .returning();

  return record ?? existing;
}

export async function deleteManagedSession(id: string) {
  const [record] = await getDb()
    .delete(managedIdentitySessions)
    .where(eq(managedIdentitySessions.id, id))
    .returning();

  return record ?? null;
}
