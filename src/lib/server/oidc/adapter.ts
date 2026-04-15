import "@tanstack/react-start/server-only";

import { and, eq, isNull, or } from "drizzle-orm";
import type { Adapter, AdapterPayload } from "oidc-provider";
import { getDb } from "../db/client";
import { oidcArtifacts, oauthClients } from "../db/schema";
import { getOAuthClientByClientId } from "../oauth-clients";

function createArtifactKey(kind: string, artifactId: string): string {
  return `${kind}:${artifactId}`;
}

function getExpiresAt(expiresIn: number): Date | null {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }
  return new Date(Date.now() + expiresIn * 1000);
}

function normalizePayload(payload: AdapterPayload): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function isExpired(payload: AdapterPayload): boolean {
  const exp = typeof payload.exp === "number" ? payload.exp : undefined;
  return exp !== undefined && exp <= Math.floor(Date.now() / 1000);
}

export class OidcArtifactAdapter implements Adapter {
  constructor(private readonly name: string) {}

  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number,
  ): Promise<void> {
    const key = createArtifactKey(this.name, id);
    const now = new Date();
    const normalized = normalizePayload(payload);
    await getDb()
      .insert(oidcArtifacts)
      .values({
        key,
        kind: this.name,
        artifactId: id,
        payload: normalized,
        grantId: typeof payload.grantId === "string" ? payload.grantId : null,
        userCode: typeof payload.userCode === "string" ? payload.userCode : null,
        uid: typeof payload.uid === "string" ? payload.uid : null,
        consumedAt: null,
        expiresAt: getExpiresAt(expiresIn),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: oidcArtifacts.key,
        set: {
          payload: normalized,
          grantId: typeof payload.grantId === "string" ? payload.grantId : null,
          userCode: typeof payload.userCode === "string" ? payload.userCode : null,
          uid: typeof payload.uid === "string" ? payload.uid : null,
          expiresAt: getExpiresAt(expiresIn),
          updatedAt: now,
        },
      });
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    if (this.name === "Client") {
      const client = await getOAuthClientByClientId(id);
      return client?.oidc as AdapterPayload | undefined;
    }

    const row = await getDb().query.oidcArtifacts.findFirst({
      where: eq(oidcArtifacts.key, createArtifactKey(this.name, id)),
    });
    const payload = row?.payload as AdapterPayload | undefined;
    if (!payload || isExpired(payload)) {
      return undefined;
    }
    return payload;
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    const row = await getDb().query.oidcArtifacts.findFirst({
      where: and(
        eq(oidcArtifacts.kind, this.name),
        eq(oidcArtifacts.userCode, userCode),
      ),
    });
    const payload = row?.payload as AdapterPayload | undefined;
    if (!payload || isExpired(payload)) {
      return undefined;
    }
    return payload;
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const row = await getDb().query.oidcArtifacts.findFirst({
      where: and(eq(oidcArtifacts.kind, this.name), eq(oidcArtifacts.uid, uid)),
    });
    const payload = row?.payload as AdapterPayload | undefined;
    if (!payload || isExpired(payload)) {
      return undefined;
    }
    return payload;
  }

  async consume(id: string): Promise<void> {
    const row = await getDb().query.oidcArtifacts.findFirst({
      where: eq(oidcArtifacts.key, createArtifactKey(this.name, id)),
    });
    if (!row) {
      return;
    }
    const payload = row.payload as AdapterPayload;
    await getDb()
      .update(oidcArtifacts)
      .set({
        payload: {
          ...payload,
          consumed: Math.floor(Date.now() / 1000),
        },
        consumedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(oidcArtifacts.key, row.key));
  }

  async destroy(id: string): Promise<void> {
    if (this.name === "Client") {
      await getDb()
        .update(oauthClients)
        .set({
          enabled: false,
          updatedAt: new Date(),
        })
        .where(eq(oauthClients.clientId, id));
      return;
    }

    await getDb()
      .delete(oidcArtifacts)
      .where(eq(oidcArtifacts.key, createArtifactKey(this.name, id)));
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await getDb()
      .delete(oidcArtifacts)
      .where(
        and(
          eq(oidcArtifacts.kind, this.name),
          eq(oidcArtifacts.grantId, grantId),
          or(isNull(oidcArtifacts.expiresAt), eq(oidcArtifacts.grantId, grantId)),
        ),
      );
  }
}

export function createOidcAdapter(name: string): Adapter {
  return new OidcArtifactAdapter(name);
}
