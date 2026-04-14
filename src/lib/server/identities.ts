import "@tanstack/react-start/server-only";
import { prisma } from "./prisma";

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
          : "Unable to read local identity store.",
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

export async function listAdminIdentitySummaries(): Promise<{
  summaries: AdminIdentitySummary[];
  storeStatus: IdentityStoreStatus;
}> {
  const [managedIdentityRows, storeState] = await Promise.all([
    prisma.managedIdentity.findMany(),
    readStoredFlowIdentityState(),
  ]);

  const managedByIdentityId = new Map(
    managedIdentityRows.map((row) => [row.identityId, row]),
  );

  const summaries = storeState.identities
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((identity) => {
      const managed = managedByIdentityId.get(identity.id);
      const account = identity.email;
      return {
        id: identity.id,
        label: managed?.label || identity.email,
        provider: "ChatGPT local store",
        account,
        flowCount: identity.credentialCount,
        lastSeenAt: managed?.updatedAt.toISOString() || identity.updatedAt,
        status: mapManagedStatus(managed?.status, identity.encrypted),
      } satisfies AdminIdentitySummary;
    });

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
        detail: "Local identity store is not available to this app runtime.",
      },
    };
  }

  if (storeState.store.identityCount === 0) {
    return {
      summaries,
      storeStatus: {
        status: "empty",
        detail: "No locally saved ChatGPT identities have been captured yet.",
        storePath: storeState.store.rootPath,
      },
    };
  }

  return {
    summaries,
    storeStatus: {
      status: storeState.store.encrypted ? "encrypted" : "ready",
      detail: storeState.store.encrypted
        ? `Identity store is readable and encrypted at rest under ${storeState.store.rootPath}.`
        : `Identity summaries are being read from ${storeState.store.rootPath}.`,
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

  return prisma.managedIdentity.upsert({
    where: {
      identityId: params.identityId,
    },
    update: {
      email: params.email,
      label,
      status,
    },
    create: {
      identityId: params.identityId,
      email: params.email,
      label,
      status,
    },
  });
}
