import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { managedIdentities } from "./db/schema";
import { createId } from "./security";
import { m } from "#/paraglide/messages";

type FlowCredentialSummary = {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  hasPasskey: boolean;
  credentialCount: number;
  storePath: string;
  encrypted: boolean;
};

type FlowCredentialStoreSummary = {
  rootPath: string;
  accountDirectoryPath: string;
  legacyStorePath: string;
  identityCount: number;
  encrypted: boolean;
};

export interface AdminIdentitySummary {
  id: string;
  label: string;
  provider: string;
  account: string;
  flowCount: number;
  lastSeenAt: string;
  status: string;
}

export interface IdentityStoreStatus {
  status: string;
  detail: string;
  storePath?: string;
}

async function readFlowIdentityModule() {
  return import("../../../packages/flows/src/modules/credentials/index.ts");
}

async function readStoredFlowIdentityState(): Promise<{
  identities: FlowCredentialSummary[];
  store: FlowCredentialStoreSummary | null;
  error?: string;
}> {
  try {
    const [
      { listStoredChatGPTIdentitySummaries, getStoredChatGPTIdentityStoreSummary },
    ] = await Promise.all([readFlowIdentityModule()]);

    return {
      identities: listStoredChatGPTIdentitySummaries(),
      store: getStoredChatGPTIdentityStoreSummary(),
    };
  } catch (error) {
    return {
      identities: [],
      store: null,
      error:
        error instanceof Error
          ? error.message
          : m.server_identity_store_read_error(),
    };
  }
}

function mapManagedStatus(status?: string | null, encrypted?: boolean) {
  if (status === "ARCHIVED") {
    return "archived";
  }

  if (status === "REVIEW") {
    return "review";
  }

  return encrypted ? "encrypted" : "active";
}

function buildStoredIdentitySummary(
  identity: FlowCredentialSummary,
  managed?: {
    label: string | null;
    status: string;
    updatedAt: Date;
  },
): AdminIdentitySummary {
  return {
    id: identity.id,
    label: managed?.label || identity.email,
    provider: m.server_identity_provider(),
    account: identity.email,
    flowCount: identity.credentialCount,
    lastSeenAt: managed?.updatedAt.toISOString() || identity.updatedAt,
    status: mapManagedStatus(managed?.status, identity.encrypted),
  } satisfies AdminIdentitySummary;
}

function buildManagedIdentitySummary(row: {
  identityId: string;
  email: string;
  label: string | null;
  status: string;
  updatedAt: Date;
}): AdminIdentitySummary {
  return {
    id: row.identityId,
    label: row.label || row.email,
    provider: m.server_identity_provider(),
    account: row.email,
    flowCount: 0,
    lastSeenAt: row.updatedAt.toISOString(),
    status: mapManagedStatus(row.status, false),
  } satisfies AdminIdentitySummary;
}

function compareSummaryLastSeenAt(
  left: Pick<AdminIdentitySummary, "lastSeenAt">,
  right: Pick<AdminIdentitySummary, "lastSeenAt">,
) {
  return String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || ""));
}

export async function listAdminIdentitySummaries(): Promise<{
  summaries: AdminIdentitySummary[];
  storeStatus: IdentityStoreStatus;
}> {
  const [managedIdentityRows, storeState] = await Promise.all([
    getDb().query.managedIdentities.findMany(),
    readStoredFlowIdentityState(),
  ]);

  const managedByIdentityId = new Map(
    managedIdentityRows.map((row) => [row.identityId, row]),
  );
  const storedIdentityIds = new Set(storeState.identities.map((identity) => identity.id));

  const summaries = [
    ...storeState.identities.map((identity) =>
      buildStoredIdentitySummary(identity, managedByIdentityId.get(identity.id)),
    ),
    ...managedIdentityRows
      .filter((row) => !storedIdentityIds.has(row.identityId))
      .map((row) => buildManagedIdentitySummary(row)),
  ].sort(compareSummaryLastSeenAt);

  if (storeState.error) {
    return {
      summaries,
      storeStatus: {
        status: "locked",
        detail: storeState.error,
      },
    };
  }

  if (!storeState.store) {
    return {
      summaries,
      storeStatus: {
        status: "missing",
        detail: m.server_identity_store_missing(),
      },
    };
  }

  if (storeState.store.identityCount === 0) {
    return {
      summaries,
      storeStatus: {
        status: "empty",
        detail: m.server_identity_store_empty(),
        storePath: storeState.store.rootPath,
      },
    };
  }

  return {
    summaries,
    storeStatus: {
      status: storeState.store.encrypted ? "encrypted" : "ready",
      detail: storeState.store.encrypted
        ? m.server_identity_store_encrypted({
            path: storeState.store.rootPath,
          })
        : m.server_identity_store_ready({
            path: storeState.store.rootPath,
          }),
      storePath: storeState.store.rootPath,
    },
  };
}

export async function findAdminIdentitySummary(identityId: string) {
  const { summaries } = await listAdminIdentitySummaries();
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
  label?: string;
}) {
  const identityId = params.identityId.trim();
  const email = params.email.trim().toLowerCase();
  const label = params.label?.trim() || null;
  const existing = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.identityId, identityId),
  });

  if (existing) {
    const [record] = await getDb()
      .update(managedIdentities)
      .set({
        email,
        updatedAt: new Date(),
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
      status: "ACTIVE",
    })
    .returning();

  if (!created) {
    throw new Error("Unable to sync managed identity");
  }

  return created;
}
