import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";

import type { Sub2ApiConfig } from "../../../packages/cli/src/config";
import { getDb } from "./db/client";
import {
  externalServiceConfigs,
  type ExternalServiceAuthMode,
  type ExternalServiceConfigRow,
} from "./db/schema";
import { decryptSecret, encryptSecret } from "./encrypted-secrets";
import { createId } from "./security";

const SUB2API_SERVICE_KIND = "sub2api" as const;

export interface ManagedSub2ApiServiceSummary {
  id: string | null;
  kind: typeof SUB2API_SERVICE_KIND;
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  authMode: ExternalServiceAuthMode;
  hasApiKey: boolean;
  hasBearerToken: boolean;
  email: string;
  hasPassword: boolean;
  loginPath: string;
  refreshTokenPath: string;
  accountsPath: string;
  clientId: string;
  proxyId: number | null;
  concurrency: number | null;
  priority: number | null;
  groupIds: number[];
  autoFillRelatedModels: boolean;
  confirmMixedChannelRisk: boolean;
  openaiOAuthResponsesWebSocketV2Mode: Sub2ApiConfig["openaiOAuthResponsesWebSocketV2Mode"];
  updatedByUserId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface UpsertSub2ApiServiceInput {
  enabled?: boolean;
  baseUrl?: string | null;
  authMode?: ExternalServiceAuthMode;
  apiKey?: string | null;
  bearerToken?: string | null;
  email?: string | null;
  password?: string | null;
  loginPath?: string | null;
  refreshTokenPath?: string | null;
  accountsPath?: string | null;
  clientId?: string | null;
  proxyId?: number | null;
  concurrency?: number | null;
  priority?: number | null;
  groupIds?: number[] | null;
  autoFillRelatedModels?: boolean | null;
  confirmMixedChannelRisk?: boolean | null;
  openaiOAuthResponsesWebSocketV2Mode?: Sub2ApiConfig["openaiOAuthResponsesWebSocketV2Mode"] | null;
  updatedByUserId?: string;
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function resolveOptionalTextUpdate(
  nextValue: string | null | undefined,
  existingValue: string | null | undefined,
): string | undefined {
  if (nextValue === undefined) {
    return normalizeOptionalText(existingValue);
  }

  return normalizeOptionalText(nextValue);
}

function normalizeSecret(value: string | null | undefined): string | undefined {
  return normalizeOptionalText(value);
}

function resolveOptionalInteger(
  nextValue: number | null | undefined,
  existingValue: number | null | undefined,
  field: string,
): number | undefined {
  if (nextValue === undefined) {
    return existingValue ?? undefined;
  }

  if (nextValue === null) {
    return undefined;
  }

  if (!Number.isInteger(nextValue)) {
    throw new Error(`${field} must be a whole number.`);
  }

  return nextValue;
}

function normalizeGroupIds(value: number[] | null | undefined): number[] | undefined {
  if (value == null) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      value.filter((entry) => Number.isInteger(entry) && entry > 0),
    ),
  );

  return normalized.length ? normalized : undefined;
}

function resolveConfirmMixedChannelRisk(
  nextValue: boolean | null | undefined,
  existingValue: boolean | null | undefined,
): boolean | undefined {
  if (typeof nextValue === "boolean") {
    return nextValue;
  }

  if (nextValue === null) {
    return undefined;
  }

  return existingValue ?? undefined;
}

function resolveOptionalBooleanUpdate(
  nextValue: boolean | null | undefined,
  existingValue: boolean | null | undefined,
): boolean | undefined {
  if (typeof nextValue === "boolean") {
    return nextValue;
  }

  if (nextValue === null) {
    return undefined;
  }

  return existingValue ?? undefined;
}

function resolveOpenAIWSModeUpdate(
  nextValue: Sub2ApiConfig["openaiOAuthResponsesWebSocketV2Mode"] | null | undefined,
  existingValue: string | null | undefined,
): Sub2ApiConfig["openaiOAuthResponsesWebSocketV2Mode"] | undefined {
  if (nextValue === null) {
    return undefined;
  }

  const value = nextValue ?? existingValue;
  return value === "off" || value === "ctx_pool" || value === "passthrough"
    ? value
    : undefined;
}

function resolveGroupIdsUpdate(
  nextValue: number[] | null | undefined,
  existingValue: number[] | null | undefined,
): number[] | undefined {
  if (nextValue === undefined) {
    return normalizeGroupIds(existingValue);
  }

  return normalizeGroupIds(nextValue);
}

function resolveSub2ApiAuthMode(
  row: Pick<
    ExternalServiceConfigRow,
    | "authMode"
    | "apiKeyCiphertext"
    | "bearerTokenCiphertext"
    | "email"
    | "passwordCiphertext"
  > | null | undefined,
): ExternalServiceAuthMode {
  if (row?.authMode) {
    return row.authMode;
  }

  if (row?.apiKeyCiphertext) {
    return "api_key";
  }

  if (row?.bearerTokenCiphertext) {
    return "bearer_token";
  }

  if (normalizeOptionalText(row?.email) || row?.passwordCiphertext) {
    return "password";
  }

  return "api_key";
}

function isSub2ApiConfigReady(
  row: Pick<
    ExternalServiceConfigRow,
    | "enabled"
    | "baseUrl"
    | "authMode"
    | "apiKeyCiphertext"
    | "bearerTokenCiphertext"
    | "email"
    | "passwordCiphertext"
  > | null | undefined,
): boolean {
  if (!row?.enabled || !normalizeOptionalText(row.baseUrl)) {
    return false;
  }

  const authMode = resolveSub2ApiAuthMode(row);

  if (authMode === "api_key") {
    return Boolean(row.apiKeyCiphertext);
  }

  if (authMode === "bearer_token") {
    return Boolean(row.bearerTokenCiphertext);
  }

  if (authMode === "password") {
    return Boolean(
      normalizeOptionalText(row.email) && row.passwordCiphertext,
    );
  }

  return false;
}

function toSummary(
  row: ExternalServiceConfigRow | null | undefined,
): ManagedSub2ApiServiceSummary {
  const authMode = resolveSub2ApiAuthMode(row);

  return {
    id: row?.id ?? null,
    kind: SUB2API_SERVICE_KIND,
    enabled: row?.enabled ?? false,
    configured: isSub2ApiConfigReady(row),
    baseUrl: row?.baseUrl ?? "",
    authMode,
    hasApiKey: Boolean(row?.apiKeyCiphertext),
    hasBearerToken: Boolean(row?.bearerTokenCiphertext),
    email: row?.email ?? "",
    hasPassword: Boolean(row?.passwordCiphertext),
    loginPath: row?.loginPath ?? "",
    refreshTokenPath: row?.refreshTokenPath ?? "",
    accountsPath: row?.accountsPath ?? "",
    clientId: row?.clientId ?? "",
    proxyId: row?.proxyId ?? null,
    concurrency: row?.concurrency ?? null,
    priority: row?.priority ?? null,
    groupIds: normalizeGroupIds(row?.groupIds) ?? [],
    autoFillRelatedModels: row?.autoFillRelatedModels ?? false,
    confirmMixedChannelRisk: row?.confirmMixedChannelRisk ?? false,
    openaiOAuthResponsesWebSocketV2Mode:
      resolveOpenAIWSModeUpdate(undefined, row?.openaiOAuthResponsesWebSocketV2Mode) ??
      "off",
    updatedByUserId: row?.updatedByUserId ?? null,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

async function findSub2ApiServiceRow(): Promise<ExternalServiceConfigRow | null> {
  return (
    (await getDb().query.externalServiceConfigs.findFirst({
      where: eq(externalServiceConfigs.kind, SUB2API_SERVICE_KIND),
    })) ?? null
  );
}

export async function getSub2ApiServiceSummary(): Promise<ManagedSub2ApiServiceSummary> {
  return toSummary(await findSub2ApiServiceRow());
}

export async function hasEnabledSub2ApiServiceConfig(): Promise<boolean> {
  return isSub2ApiConfigReady(await findSub2ApiServiceRow());
}

export async function upsertSub2ApiServiceConfig(
  input: UpsertSub2ApiServiceInput,
): Promise<ManagedSub2ApiServiceSummary> {
  const existing = await findSub2ApiServiceRow();
  const now = new Date();
  const existingAuthMode = resolveSub2ApiAuthMode(existing);
  const authMode = input.authMode ?? existingAuthMode;
  const enabled = input.enabled ?? existing?.enabled ?? false;
  const baseUrl = resolveOptionalTextUpdate(input.baseUrl, existing?.baseUrl);
  const email =
    authMode === "password"
      ? resolveOptionalTextUpdate(input.email, existing?.email)
      : undefined;

  const nextApiKey =
    authMode === "api_key" ? normalizeSecret(input.apiKey) : undefined;
  const nextBearerToken =
    authMode === "bearer_token" ? normalizeSecret(input.bearerToken) : undefined;
  const nextPassword =
    authMode === "password" ? normalizeSecret(input.password) : undefined;

  const apiKeyCiphertext =
    authMode === "api_key"
      ? nextApiKey
        ? encryptSecret(nextApiKey, "manage Sub2API API keys")
        : existingAuthMode === "api_key"
          ? existing?.apiKeyCiphertext ?? undefined
          : undefined
      : undefined;

  const bearerTokenCiphertext =
    authMode === "bearer_token"
      ? nextBearerToken
        ? encryptSecret(nextBearerToken, "manage Sub2API bearer tokens")
        : existingAuthMode === "bearer_token"
          ? existing.bearerTokenCiphertext ?? undefined
          : undefined
      : undefined;

  const passwordCiphertext =
    authMode === "password"
      ? nextPassword
        ? encryptSecret(nextPassword, "manage Sub2API passwords")
        : existingAuthMode === "password"
          ? existing.passwordCiphertext ?? undefined
          : undefined
      : undefined;

  if (enabled) {
    if (!baseUrl) {
      throw new Error("Sub2API base URL is required before enabling the service.");
    }

    if (authMode === "api_key" && !apiKeyCiphertext) {
      throw new Error(
        "Sub2API API key is required before enabling api-key auth.",
      );
    }

    if (authMode === "bearer_token" && !bearerTokenCiphertext) {
      throw new Error(
        "Sub2API bearer token is required before enabling bearer-token auth.",
      );
    }

    if (authMode === "password") {
      if (!email) {
        throw new Error(
          "Sub2API email is required before enabling password auth.",
        );
      }

      if (!passwordCiphertext) {
        throw new Error(
          "Sub2API password is required before enabling password auth.",
        );
      }
    }
  }

  const payload = {
    kind: SUB2API_SERVICE_KIND,
    enabled,
    baseUrl: baseUrl ?? null,
    authMode,
    apiKeyCiphertext: apiKeyCiphertext ?? null,
    bearerTokenCiphertext: bearerTokenCiphertext ?? null,
    email: email ?? null,
    passwordCiphertext: passwordCiphertext ?? null,
    loginPath: resolveOptionalTextUpdate(input.loginPath, existing?.loginPath) ?? null,
    refreshTokenPath:
      resolveOptionalTextUpdate(
        input.refreshTokenPath,
        existing?.refreshTokenPath,
      ) ?? null,
    accountsPath:
      resolveOptionalTextUpdate(input.accountsPath, existing?.accountsPath) ?? null,
    clientId: resolveOptionalTextUpdate(input.clientId, existing?.clientId) ?? null,
    proxyId: resolveOptionalInteger(input.proxyId, existing?.proxyId, "proxyId") ?? null,
    concurrency:
      resolveOptionalInteger(
        input.concurrency,
        existing?.concurrency,
        "concurrency",
      ) ?? null,
    priority:
      resolveOptionalInteger(input.priority, existing?.priority, "priority") ?? null,
    groupIds: resolveGroupIdsUpdate(input.groupIds, existing?.groupIds) ?? null,
    autoFillRelatedModels:
      resolveOptionalBooleanUpdate(
        input.autoFillRelatedModels,
        existing?.autoFillRelatedModels,
      ) ?? null,
    confirmMixedChannelRisk:
      resolveConfirmMixedChannelRisk(
        input.confirmMixedChannelRisk,
        existing?.confirmMixedChannelRisk,
      ) ?? null,
    openaiOAuthResponsesWebSocketV2Mode:
      resolveOpenAIWSModeUpdate(
        input.openaiOAuthResponsesWebSocketV2Mode,
        existing?.openaiOAuthResponsesWebSocketV2Mode,
      ) ?? null,
    updatedByUserId: input.updatedByUserId?.trim() || null,
    updatedAt: now,
  };

  const [row] = existing
    ? await getDb()
        .update(externalServiceConfigs)
        .set(payload)
        .where(eq(externalServiceConfigs.id, existing.id))
        .returning()
    : await getDb()
        .insert(externalServiceConfigs)
        .values({
          id: createId(),
          ...payload,
          createdAt: now,
        })
        .returning();

  if (!row) {
    throw new Error("Unable to save Sub2API configuration.");
  }

  return toSummary(row);
}

export async function getCliSub2ApiConfig(): Promise<Sub2ApiConfig> {
  const row = await findSub2ApiServiceRow();
  if (!isSub2ApiConfigReady(row)) {
    throw new Error("Sub2API app configuration is not enabled.");
  }

  if (!row?.baseUrl) {
    throw new Error("Sub2API app configuration is incomplete.");
  }

  const authMode = resolveSub2ApiAuthMode(row);

  if (authMode === "api_key") {
    if (!row.apiKeyCiphertext) {
      throw new Error("Sub2API API key is not configured.");
    }

    return {
      baseUrl: row.baseUrl,
      apiKey: decryptSecret(
        row.apiKeyCiphertext,
        "decrypt a Sub2API API key",
      ),
      loginPath: row.loginPath ?? undefined,
      refreshTokenPath: row.refreshTokenPath ?? undefined,
      accountsPath: row.accountsPath ?? undefined,
      clientId: row.clientId ?? undefined,
      proxyId: row.proxyId ?? undefined,
      concurrency: row.concurrency ?? undefined,
      priority: row.priority ?? undefined,
      groupIds: normalizeGroupIds(row.groupIds),
      autoFillRelatedModels: row.autoFillRelatedModels ?? undefined,
      confirmMixedChannelRisk: row.confirmMixedChannelRisk ?? undefined,
      openaiOAuthResponsesWebSocketV2Mode:
        resolveOpenAIWSModeUpdate(undefined, row.openaiOAuthResponsesWebSocketV2Mode),
    };
  }

  if (authMode === "bearer_token") {
    if (!row.bearerTokenCiphertext) {
      throw new Error("Sub2API bearer token is not configured.");
    }

    return {
      baseUrl: row.baseUrl,
      bearerToken: decryptSecret(
        row.bearerTokenCiphertext,
        "decrypt a Sub2API bearer token",
      ),
      loginPath: row.loginPath ?? undefined,
      refreshTokenPath: row.refreshTokenPath ?? undefined,
      accountsPath: row.accountsPath ?? undefined,
      clientId: row.clientId ?? undefined,
      proxyId: row.proxyId ?? undefined,
      concurrency: row.concurrency ?? undefined,
      priority: row.priority ?? undefined,
      groupIds: normalizeGroupIds(row.groupIds),
      autoFillRelatedModels: row.autoFillRelatedModels ?? undefined,
      confirmMixedChannelRisk: row.confirmMixedChannelRisk ?? undefined,
      openaiOAuthResponsesWebSocketV2Mode:
        resolveOpenAIWSModeUpdate(undefined, row.openaiOAuthResponsesWebSocketV2Mode),
    };
  }

  if (!row.email || !row.passwordCiphertext) {
    throw new Error("Sub2API password auth is incomplete.");
  }

  return {
    baseUrl: row.baseUrl,
    email: row.email,
    password: decryptSecret(
      row.passwordCiphertext,
      "decrypt a Sub2API password",
    ),
    loginPath: row.loginPath ?? undefined,
    refreshTokenPath: row.refreshTokenPath ?? undefined,
    accountsPath: row.accountsPath ?? undefined,
    clientId: row.clientId ?? undefined,
    proxyId: row.proxyId ?? undefined,
    concurrency: row.concurrency ?? undefined,
    priority: row.priority ?? undefined,
    groupIds: normalizeGroupIds(row.groupIds),
    autoFillRelatedModels: row.autoFillRelatedModels ?? undefined,
    confirmMixedChannelRisk: row.confirmMixedChannelRisk ?? undefined,
    openaiOAuthResponsesWebSocketV2Mode:
      resolveOpenAIWSModeUpdate(undefined, row.openaiOAuthResponsesWebSocketV2Mode),
  };
}
