import "@tanstack/react-start/server-only";

import crypto from "node:crypto";
import {
  desc,
  eq,
  gt,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { getDb, type Database } from "../db/client";
import {
  oidcSigningKeys,
  type OidcSigningKeyRow,
} from "../db/schema";
import { getAppEnv } from "../env";
import { createId } from "../security";

type StoredJwk = Record<string, unknown>;
type DbLike = Pick<
  Database,
  "execute" | "insert" | "query" | "update"
>;

export interface OidcSigningJwksSnapshot {
  keys: StoredJwk[];
  version: string;
  activeKid: string;
  activeKeyCount: number;
  publishedKeyCount: number;
  nextRotationAt: Date | null;
}

export interface OidcSigningKeyStatus {
  status: "ready" | "warning" | "missing";
  detail: string;
  activeKid?: string;
  nextRotationAt?: Date | null;
  publishedKeyCount: number;
}

declare global {
  var __codeyOidcJwksCache:
    | {
        expiresAt: number;
        snapshot: OidcSigningJwksSnapshot;
      }
    | undefined;
  var __codeyOidcJwksPromise: Promise<OidcSigningJwksSnapshot> | undefined;
}

const DEFAULT_ROTATION_DAYS = 30;
const DEFAULT_RETENTION_DAYS = 7;
const CACHE_TTL_MS = 30_000;
const SIGNING_ALGORITHM = "RS256";
const ADVISORY_LOCK_KEY = 1_947_102_401;
const PRIVATE_JWK_FIELDS = new Set([
  "d",
  "p",
  "q",
  "dp",
  "dq",
  "qi",
  "oth",
  "k",
]);

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function readPositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readRotationPolicy() {
  const env = getAppEnv();
  return {
    rotationDays: readPositiveInteger(
      env.oauthSigningKeyRotationDays,
      DEFAULT_ROTATION_DAYS,
    ),
    retentionDays: readPositiveInteger(
      env.oauthSigningKeyRetentionDays,
      DEFAULT_RETENTION_DAYS,
    ),
  };
}

function hasPrivateKeyMaterial(jwk: StoredJwk): boolean {
  return (
    typeof jwk.d === "string" ||
    typeof jwk.k === "string"
  );
}

function toPublicJwk(jwk: StoredJwk): StoredJwk {
  return Object.fromEntries(
    Object.entries(jwk).filter(([key]) => !PRIVATE_JWK_FIELDS.has(key)),
  );
}

async function ensureKid(jwk: StoredJwk): Promise<string> {
  if (typeof jwk.kid === "string" && jwk.kid.trim()) {
    return jwk.kid.trim();
  }

  const kty = typeof jwk.kty === "string" ? jwk.kty : "";
  const canonicalMembers =
    kty === "RSA"
      ? {
          e: String(jwk.e || ""),
          kty,
          n: String(jwk.n || ""),
        }
      : kty === "EC"
        ? {
            crv: String(jwk.crv || ""),
            kty,
            x: String(jwk.x || ""),
            y: String(jwk.y || ""),
          }
        : kty === "OKP"
          ? {
              crv: String(jwk.crv || ""),
              kty,
              x: String(jwk.x || ""),
            }
          : kty === "oct"
            ? {
                k: String(jwk.k || ""),
                kty,
              }
            : Object.fromEntries(
                Object.entries(jwk)
                  .filter(
                    ([, value]) =>
                      typeof value === "string" && value.trim().length > 0,
                  )
                  .sort(([left], [right]) => left.localeCompare(right)),
              );

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalMembers))
    .digest("base64url");
}

function normalizePrivateJwk(
  jwk: StoredJwk,
  kid: string,
  algorithm = SIGNING_ALGORITHM,
): StoredJwk {
  return {
    ...jwk,
    kid,
    use: "sig",
    alg: typeof jwk.alg === "string" && jwk.alg.trim() ? jwk.alg : algorithm,
  };
}

function normalizePublicJwk(
  jwk: StoredJwk,
  kid: string,
  algorithm = SIGNING_ALGORITHM,
): StoredJwk {
  return {
    ...jwk,
    kid,
    use: "sig",
    alg: typeof jwk.alg === "string" && jwk.alg.trim() ? jwk.alg : algorithm,
  };
}

async function generateSigningKeyMaterial(): Promise<{
  kid: string;
  algorithm: string;
  publicJwk: StoredJwk;
  privateJwk: StoredJwk;
}> {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { format: "jwk" },
    privateKeyEncoding: { format: "jwk" },
  });
  const exportedPublic = publicKey as StoredJwk;
  const kid = await ensureKid(exportedPublic);

  return {
    kid,
    algorithm: SIGNING_ALGORITHM,
    publicJwk: normalizePublicJwk(exportedPublic, kid),
    privateJwk: normalizePrivateJwk(privateKey as StoredJwk, kid),
  };
}

async function listPublishedSigningKeys(
  db: DbLike,
  now: Date,
): Promise<OidcSigningKeyRow[]> {
  return db.query.oidcSigningKeys.findMany({
    where: or(
      isNull(oidcSigningKeys.retiresAt),
      gt(oidcSigningKeys.retiresAt, now),
    ),
    orderBy: [
      desc(oidcSigningKeys.isActive),
      desc(oidcSigningKeys.activatedAt),
      desc(oidcSigningKeys.createdAt),
    ],
  });
}

async function insertSigningKey(
  db: DbLike,
  params: {
    kid: string;
    algorithm: string;
    publicJwk: StoredJwk;
    privateJwk: StoredJwk;
    isActive: boolean;
    activatedAt: Date;
    rotatesAt: Date;
    retiresAt: Date | null;
  },
): Promise<void> {
  await db.insert(oidcSigningKeys).values({
    id: createId(),
    kid: params.kid,
    algorithm: params.algorithm,
    publicJwk: params.publicJwk,
    privateJwk: params.privateJwk,
    isActive: params.isActive,
    activatedAt: params.activatedAt,
    rotatesAt: params.rotatesAt,
    retiresAt: params.retiresAt,
    createdAt: params.activatedAt,
    updatedAt: params.activatedAt,
  });
}

async function seedLegacyEnvSigningKeys(
  db: DbLike,
  now: Date,
): Promise<boolean> {
  const envSeed = getAppEnv().oauthJwksSeed;
  if (!envSeed?.keys?.length) {
    return false;
  }

  const policy = readRotationPolicy();
  let importedCount = 0;

  for (const [index, rawKey] of envSeed.keys.entries()) {
    if (!rawKey || typeof rawKey !== "object" || Array.isArray(rawKey)) {
      continue;
    }

    const privateJwk = rawKey as StoredJwk;
    if (!hasPrivateKeyMaterial(privateJwk)) {
      continue;
    }

    const publicJwk = toPublicJwk(privateJwk);
    const kid = await ensureKid(publicJwk);
    const isActive = importedCount === 0;

    await insertSigningKey(db, {
      kid,
      algorithm:
        typeof privateJwk.alg === "string" && privateJwk.alg.trim()
          ? privateJwk.alg
          : SIGNING_ALGORITHM,
      publicJwk: normalizePublicJwk(publicJwk, kid),
      privateJwk: normalizePrivateJwk(privateJwk, kid),
      isActive,
      activatedAt: now,
      rotatesAt: isActive ? addDays(now, policy.rotationDays) : now,
      retiresAt: isActive ? null : addDays(now, policy.retentionDays),
    });
    importedCount += 1;

    if (index >= envSeed.keys.length - 1) {
      continue;
    }
  }

  return importedCount > 0;
}

async function createInitialSigningKey(db: DbLike, now: Date): Promise<void> {
  const policy = readRotationPolicy();
  const material = await generateSigningKeyMaterial();

  await insertSigningKey(db, {
    ...material,
    isActive: true,
    activatedAt: now,
    rotatesAt: addDays(now, policy.rotationDays),
    retiresAt: null,
  });
}

async function rotateSigningKey(
  db: DbLike,
  current: OidcSigningKeyRow,
  now: Date,
): Promise<void> {
  const policy = readRotationPolicy();
  const material = await generateSigningKeyMaterial();

  await db
    .update(oidcSigningKeys)
    .set({
      isActive: false,
      retiresAt: addDays(now, policy.retentionDays),
      updatedAt: now,
    })
    .where(eq(oidcSigningKeys.id, current.id));

  await insertSigningKey(db, {
    ...material,
    isActive: true,
    activatedAt: now,
    rotatesAt: addDays(now, policy.rotationDays),
    retiresAt: null,
  });
}

async function ensurePublishedSigningKeys(
  db: DbLike,
  now: Date,
): Promise<OidcSigningKeyRow[]> {
  let keys = await listPublishedSigningKeys(db, now);
  if (!keys.length) {
    const seeded = await seedLegacyEnvSigningKeys(db, now);
    if (!seeded) {
      await createInitialSigningKey(db, now);
    }
    keys = await listPublishedSigningKeys(db, now);
  }

  const activeKey = keys.find((key) => key.isActive);
  if (!activeKey) {
    await createInitialSigningKey(db, now);
    return listPublishedSigningKeys(db, now);
  }

  if (activeKey.rotatesAt.getTime() <= now.getTime()) {
    await rotateSigningKey(db, activeKey, now);
    return listPublishedSigningKeys(db, now);
  }

  return keys;
}

function buildSnapshot(rows: OidcSigningKeyRow[], now: Date): OidcSigningJwksSnapshot {
  const activeRows = rows.filter((row) => row.isActive);
  const activeKey = activeRows[0];
  if (!activeKey) {
    throw new Error("OIDC signing keys are missing an active signing key.");
  }

  const version = rows
    .map((row) =>
      [
        row.kid,
        row.updatedAt.getTime(),
        row.isActive ? "1" : "0",
        row.retiresAt?.getTime() ?? "active",
      ].join(":"),
    )
    .join("|");

  const nextRotationAt = activeKey.rotatesAt;
  const ttlExpiry = now.getTime() + CACHE_TTL_MS;
  const expiresAt = Math.min(ttlExpiry, nextRotationAt.getTime());
  globalThis.__codeyOidcJwksCache = {
    expiresAt,
    snapshot: {
      keys: rows.map((row) => row.privateJwk as StoredJwk),
      version,
      activeKid: activeKey.kid,
      activeKeyCount: activeRows.length,
      publishedKeyCount: rows.length,
      nextRotationAt,
    },
  };

  return globalThis.__codeyOidcJwksCache.snapshot;
}

async function loadSnapshot(forceRefresh = false): Promise<OidcSigningJwksSnapshot> {
  const cached = globalThis.__codeyOidcJwksCache;
  const now = new Date();
  if (
    !forceRefresh &&
    cached &&
    cached.expiresAt > now.getTime()
  ) {
    return cached.snapshot;
  }

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);
    const keys = await ensurePublishedSigningKeys(tx, now);
    return buildSnapshot(keys, now);
  });
}

export function invalidateOidcSigningKeyCache(): void {
  globalThis.__codeyOidcJwksCache = undefined;
}

export async function getManagedOidcJwks(
  options: { forceRefresh?: boolean } = {},
): Promise<OidcSigningJwksSnapshot> {
  if (!options.forceRefresh && globalThis.__codeyOidcJwksCache) {
    const cached = globalThis.__codeyOidcJwksCache;
    if (cached.expiresAt > Date.now()) {
      return cached.snapshot;
    }
  }

  if (!globalThis.__codeyOidcJwksPromise) {
    globalThis.__codeyOidcJwksPromise = loadSnapshot(
      options.forceRefresh ?? false,
    ).finally(() => {
      globalThis.__codeyOidcJwksPromise = undefined;
    });
  }

  return globalThis.__codeyOidcJwksPromise;
}

export async function getOidcSigningKeyStatus(): Promise<OidcSigningKeyStatus> {
  const snapshot = await getManagedOidcJwks();
  const nextRotationLabel = snapshot.nextRotationAt
    ? snapshot.nextRotationAt.toISOString()
    : "not scheduled";
  return {
    status:
      snapshot.activeKeyCount === 1
        ? "ready"
        : snapshot.activeKeyCount > 1
          ? "warning"
          : "missing",
    detail:
      snapshot.activeKeyCount === 1
        ? `DB-backed signing keys are active. Current kid: ${snapshot.activeKid}. Published keys: ${snapshot.publishedKeyCount}. Next automatic rotation: ${nextRotationLabel}.`
        : `Expected exactly one active signing key, found ${snapshot.activeKeyCount}. Published keys: ${snapshot.publishedKeyCount}.`,
    activeKid: snapshot.activeKid,
    nextRotationAt: snapshot.nextRotationAt,
    publishedKeyCount: snapshot.publishedKeyCount,
  };
}
