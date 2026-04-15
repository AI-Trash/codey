import "@tanstack/react-start/server-only";

import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { ClientMetadata, ResponseType } from "oidc-provider";
import { getDb } from "./db/client";
import {
  oauthClients,
  type OAuthClientAuthMethod,
  type OAuthClientRow,
} from "./db/schema";
import { getAppEnv } from "./env";
import { DEFAULT_OAUTH_SUPPORTED_SCOPES } from "./oauth-scopes";
import { createId, randomToken } from "./security";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

function getDefaultAllowedScopes(): string[] {
  return getAppEnv().oauthSupportedScopes.length
    ? getAppEnv().oauthSupportedScopes
    : DEFAULT_OAUTH_SUPPORTED_SCOPES;
}

export interface ManagedOAuthClientSecret {
  clientId: string;
  clientSecret: string;
  preview: string;
}

export interface CreateOAuthClientInput {
  clientName: string;
  description?: string;
  allowedScopes?: string[];
  enabled?: boolean;
  clientCredentialsEnabled?: boolean;
  deviceFlowEnabled?: boolean;
  tokenEndpointAuthMethod?: OAuthClientAuthMethod;
  createdByUserId?: string;
}

export interface UpdateOAuthClientInput {
  clientName?: string;
  description?: string | null;
  allowedScopes?: string[];
  enabled?: boolean;
  clientCredentialsEnabled?: boolean;
  deviceFlowEnabled?: boolean;
  tokenEndpointAuthMethod?: OAuthClientAuthMethod;
  updatedByUserId?: string;
  rotateSecret?: boolean;
}

export interface OAuthClientSummary {
  id: string;
  clientId: string;
  clientName: string;
  description: string | null;
  enabled: boolean;
  clientCredentialsEnabled: boolean;
  deviceFlowEnabled: boolean;
  tokenEndpointAuthMethod: OAuthClientAuthMethod;
  allowedScopes: string[];
  clientSecretPreview: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  clientSecretUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthClientRecord extends OAuthClientSummary {
  oidc: ClientMetadata;
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  const values = (scopes || getDefaultAllowedScopes())
    .map((scope) => scope.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).sort();
}

function serializeScopes(scopes: string[]): string {
  return normalizeScopes(scopes).join(" ");
}

function parseScopes(scopes: string): string[] {
  return scopes
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizeClientName(value: string): string {
  const clientName = value.trim();
  if (!clientName) {
    throw new Error("clientName is required");
  }
  return clientName;
}

function getGrantTypes(row: Pick<
  OAuthClientRow,
  "clientCredentialsEnabled" | "deviceFlowEnabled"
>): string[] {
  const grantTypes: string[] = [];
  if (row.clientCredentialsEnabled) {
    grantTypes.push("client_credentials");
  }
  if (row.deviceFlowEnabled) {
    grantTypes.push(DEVICE_CODE_GRANT);
  }
  if (!grantTypes.length) {
    throw new Error("At least one OAuth grant must be enabled for a managed client");
  }
  return grantTypes;
}

function getResponseTypes(
  row: Pick<OAuthClientRow, "deviceFlowEnabled">,
): ResponseType[] {
  return row.deviceFlowEnabled ? ["none"] : [];
}

function getRedirectUris(row: Pick<OAuthClientRow, "deviceFlowEnabled">): string[] {
  return row.deviceFlowEnabled ? [] : [];
}

function getPostLogoutRedirectUris(
  _row: Pick<OAuthClientRow, "deviceFlowEnabled">,
): string[] {
  return [];
}

function makeClientSecretPreview(clientSecret: string): string {
  return clientSecret.slice(0, 8);
}

function getEncryptionKey(): Buffer {
  const env = getAppEnv();
  if (!env.oauthClientSecretEncryptionKey) {
    throw new Error(
      "OAUTH_CLIENT_SECRET_ENCRYPTION_KEY is required to manage OAuth client secrets",
    );
  }

  return Buffer.from(env.oauthClientSecretEncryptionKey, "base64");
}

function encryptClientSecret(clientSecret: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(clientSecret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptClientSecret(ciphertext: string): string {
  const [ivPart, tagPart, dataPart] = ciphertext.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Stored OAuth client secret is malformed");
  }
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function buildManagedClientMetadata(
  row: OAuthClientRow,
  clientSecret: string,
): ClientMetadata {
  return {
    client_id: row.clientId,
    client_name: row.clientName,
    client_secret: clientSecret,
    client_secret_expires_at: 0,
    grant_types: getGrantTypes(row),
    response_types: getResponseTypes(row),
    redirect_uris: getRedirectUris(row),
    post_logout_redirect_uris: getPostLogoutRedirectUris(row),
    token_endpoint_auth_method: row.tokenEndpointAuthMethod,
    scope: row.allowedScopes,
  };
}

function toSummary(row: OAuthClientRow): OAuthClientSummary {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    description: row.description,
    enabled: row.enabled,
    clientCredentialsEnabled: row.clientCredentialsEnabled,
    deviceFlowEnabled: row.deviceFlowEnabled,
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    allowedScopes: parseScopes(row.allowedScopes),
    clientSecretPreview: row.clientSecretPreview,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    clientSecretUpdatedAt: row.clientSecretUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function createManagedClientId(): string {
  return `codey_${randomToken(18)}`;
}

export function generateManagedOAuthClientSecret(): ManagedOAuthClientSecret {
  const clientSecret = randomToken(32);
  return {
    clientId: createManagedClientId(),
    clientSecret,
    preview: makeClientSecretPreview(clientSecret),
  };
}

export async function listOAuthClients(): Promise<OAuthClientSummary[]> {
  const rows = await getDb().query.oauthClients.findMany({
    orderBy: [desc(oauthClients.createdAt)],
  });
  return rows.map(toSummary);
}

export async function getOAuthClientById(
  id: string,
): Promise<OAuthClientRecord | null> {
  const row = await getDb().query.oauthClients.findFirst({
    where: eq(oauthClients.id, id),
  });
  if (!row) {
    return null;
  }
  const clientSecret = decryptClientSecret(row.clientSecretCiphertext);
  return {
    ...toSummary(row),
    oidc: buildManagedClientMetadata(row, clientSecret),
  };
}

export async function getOAuthClientSummaryById(
  id: string,
): Promise<OAuthClientSummary | null> {
  const row = await getDb().query.oauthClients.findFirst({
    where: eq(oauthClients.id, id),
  });
  return row ? toSummary(row) : null;
}

export async function getOAuthClientByClientId(
  clientId: string,
): Promise<OAuthClientRecord | null> {
  const row = await getDb().query.oauthClients.findFirst({
    where: eq(oauthClients.clientId, clientId),
  });
  if (!row || !row.enabled) {
    return null;
  }
  const clientSecret = decryptClientSecret(row.clientSecretCiphertext);
  return {
    ...toSummary(row),
    oidc: buildManagedClientMetadata(row, clientSecret),
  };
}

export async function createOAuthClient(input: CreateOAuthClientInput): Promise<{
  client: OAuthClientRecord;
  clientSecret: string;
}> {
  const clientName = normalizeClientName(input.clientName);
  const now = new Date();
  const generated = generateManagedOAuthClientSecret();
  const allowedScopes = serializeScopes(
    input.allowedScopes || getDefaultAllowedScopes(),
  );
  const enabled = input.enabled ?? true;
  const clientCredentialsEnabled = input.clientCredentialsEnabled ?? false;
  const deviceFlowEnabled = input.deviceFlowEnabled ?? false;

  if (!clientCredentialsEnabled && !deviceFlowEnabled) {
    throw new Error("At least one of client credentials or device flow must be enabled");
  }

  const [row] = await getDb()
    .insert(oauthClients)
    .values({
      id: createId(),
      clientId: generated.clientId,
      clientName,
      description: input.description?.trim() || null,
      enabled,
      clientCredentialsEnabled,
      deviceFlowEnabled,
      tokenEndpointAuthMethod:
        input.tokenEndpointAuthMethod || "client_secret_basic",
      clientSecretCiphertext: encryptClientSecret(generated.clientSecret),
      clientSecretPreview: generated.preview,
      allowedScopes,
      createdByUserId: input.createdByUserId || null,
      updatedByUserId: input.createdByUserId || null,
      clientSecretUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Unable to create OAuth client");
  }

  return {
    client: {
      ...toSummary(row),
      oidc: buildManagedClientMetadata(row, generated.clientSecret),
    },
    clientSecret: generated.clientSecret,
  };
}

export async function updateOAuthClient(
  id: string,
  input: UpdateOAuthClientInput,
): Promise<{
  client: OAuthClientRecord;
  rotatedSecret?: string;
}> {
  const existing = await getDb().query.oauthClients.findFirst({
    where: eq(oauthClients.id, id),
  });
  if (!existing) {
    throw new Error("OAuth client not found");
  }

  const now = new Date();
  const clientName = input.clientName
    ? normalizeClientName(input.clientName)
    : existing.clientName;
  const description =
    input.description === undefined
      ? existing.description
      : input.description?.trim() || null;
  const enabled = input.enabled ?? existing.enabled;
  const clientCredentialsEnabled =
    input.clientCredentialsEnabled ?? existing.clientCredentialsEnabled;
  const deviceFlowEnabled = input.deviceFlowEnabled ?? existing.deviceFlowEnabled;

  if (!clientCredentialsEnabled && !deviceFlowEnabled) {
    throw new Error("At least one of client credentials or device flow must be enabled");
  }

  let clientSecretCiphertext = existing.clientSecretCiphertext;
  let clientSecretPreview = existing.clientSecretPreview;
  let clientSecretUpdatedAt = existing.clientSecretUpdatedAt;
  let rotatedSecret: string | undefined;

  if (input.rotateSecret) {
    rotatedSecret = randomToken(32);
    clientSecretCiphertext = encryptClientSecret(rotatedSecret);
    clientSecretPreview = makeClientSecretPreview(rotatedSecret);
    clientSecretUpdatedAt = now;
  }

  const [row] = await getDb()
    .update(oauthClients)
    .set({
      clientName,
      description,
      enabled,
      clientCredentialsEnabled,
      deviceFlowEnabled,
      tokenEndpointAuthMethod:
        input.tokenEndpointAuthMethod || existing.tokenEndpointAuthMethod,
      allowedScopes:
        input.allowedScopes === undefined
          ? existing.allowedScopes
          : serializeScopes(input.allowedScopes),
      clientSecretCiphertext,
      clientSecretPreview,
      clientSecretUpdatedAt,
      updatedByUserId: input.updatedByUserId || existing.updatedByUserId,
      updatedAt: now,
    })
    .where(eq(oauthClients.id, id))
    .returning();

  if (!row) {
    throw new Error("Unable to update OAuth client");
  }

  const effectiveSecret = rotatedSecret || decryptClientSecret(row.clientSecretCiphertext);

  return {
    client: {
      ...toSummary(row),
      oidc: buildManagedClientMetadata(row, effectiveSecret),
    },
    rotatedSecret,
  };
}
