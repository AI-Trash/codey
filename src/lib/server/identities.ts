import "@tanstack/react-start/server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { managedIdentities } from "./db/schema";
import { createId } from "./security";
import { m } from "#/paraglide/messages";

export interface AdminIdentitySummary {
  id: string;
  label: string;
  provider: string;
  account: string;
  flowCount: number;
  lastSeenAt: string;
  status: string;
}

function mapManagedStatus(status?: string | null) {
  if (status === "ARCHIVED") {
    return "archived";
  }

  if (status === "REVIEW") {
    return "review";
  }

  return "active";
}

function buildManagedIdentitySummary(row: {
  identityId: string;
  email: string;
  label: string | null;
  credentialCount: number;
  status: string;
  lastSeenAt: Date;
}): AdminIdentitySummary {
  return {
    id: row.identityId,
    label: row.label || row.email,
    provider: m.server_identity_provider(),
    account: row.email,
    flowCount: row.credentialCount,
    lastSeenAt: row.lastSeenAt.toISOString(),
    status: mapManagedStatus(row.status),
  } satisfies AdminIdentitySummary;
}

export async function listAdminIdentitySummaries(): Promise<AdminIdentitySummary[]> {
  const managedIdentityRows = await getDb().query.managedIdentities.findMany({
    orderBy: [desc(managedIdentities.lastSeenAt)],
  });

  return managedIdentityRows.map((row) => buildManagedIdentitySummary(row));
}

export async function findAdminIdentitySummary(identityId: string) {
  const summaries = await listAdminIdentitySummaries();
  return summaries.find((summary) => summary.id === identityId) || null;
}

export async function upsertManagedIdentity(params: {
  identityId: string;
  email: string;
  label?: string;
  status?: "ACTIVE" | "REVIEW" | "ARCHIVED";
}) {
  const label = params.label?.trim() || undefined;
  const status = params.status || "ACTIVE";

  const [record] = await getDb()
    .insert(managedIdentities)
    .values({
      id: createId(),
      identityId: params.identityId,
      email: params.email,
      label,
      status,
    })
    .onConflictDoUpdate({
      target: managedIdentities.identityId,
      set: {
        email: params.email,
        label,
        status,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!record) {
    const existing = await getDb().query.managedIdentities.findFirst({
      where: eq(managedIdentities.identityId, params.identityId),
    });
    if (!existing) {
      throw new Error("Unable to persist managed identity");
    }
    return existing;
  }

  return record;
}

export async function syncManagedIdentity(params: {
  identityId: string;
  email: string;
  credentialCount?: number;
  label?: string;
}) {
  const identityId = params.identityId.trim();
  const email = params.email.trim().toLowerCase();
  const credentialCount =
    Number.isFinite(params.credentialCount) && Number(params.credentialCount) > 0
      ? Math.floor(Number(params.credentialCount))
      : 0;
  const label = params.label?.trim() || null;
  const seenAt = new Date();
  const existing = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.identityId, identityId),
  });

  if (existing) {
    const [record] = await getDb()
      .update(managedIdentities)
      .set({
        email,
        credentialCount,
        lastSeenAt: seenAt,
        updatedAt: seenAt,
      })
      .where(eq(managedIdentities.identityId, identityId))
      .returning();

    if (record) {
      return record;
    }
  }

  const [created] = await getDb()
    .insert(managedIdentities)
    .values({
      id: createId(),
      identityId,
      email,
      label,
      credentialCount,
      status: "ACTIVE",
      lastSeenAt: seenAt,
    })
    .returning();

  if (!created) {
    throw new Error("Unable to sync managed identity");
  }

  return created;
}
