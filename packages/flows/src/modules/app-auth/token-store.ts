import fs from "fs";
import path from "path";
import { getRuntimeConfig } from "../../config";
import { ensureDir, writeFileAtomic } from "../../utils/fs";
import type { AppSessionUser, AppTokenSet } from "./types";

export interface StoredAppSession {
  version: 2;
  tokenSet: AppTokenSet;
  target?: string;
  subject?: string;
  user?: AppSessionUser;
  createdAt: string;
}

interface LegacyStoredAppSession {
  accessToken: string;
  target?: string;
  user?: AppSessionUser;
  createdAt: string;
}

function getStorePath(): string {
  const config = getRuntimeConfig();
  return path.join(config.rootDir, ".codey", "credentials", "app-session.json");
}

function readIdTokenSubject(idToken: string | undefined): string | undefined {
  if (!idToken) {
    return undefined;
  }

  const [, payload] = idToken.split(".");
  if (!payload) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof parsed.sub === "string" ? parsed.sub : undefined;
  } catch {
    return undefined;
  }
}

export function createStoredAppSession(input: {
  tokenSet: AppTokenSet;
  target?: string;
  subject?: string;
  user?: AppSessionUser;
}): StoredAppSession {
  return {
    version: 2,
    tokenSet: input.tokenSet,
    target: input.target,
    subject: input.subject || readIdTokenSubject(input.tokenSet.idToken),
    user: input.user,
    createdAt: input.tokenSet.obtainedAt,
  };
}

function normalizeStoredAppSession(
  session: StoredAppSession | LegacyStoredAppSession,
): StoredAppSession {
  if ("tokenSet" in session && session.tokenSet) {
    return {
      version: 2,
      tokenSet: {
        ...session.tokenSet,
        tokenType: session.tokenSet.tokenType || "Bearer",
        obtainedAt: session.tokenSet.obtainedAt || session.createdAt,
      },
      target: session.target,
      subject: session.subject || readIdTokenSubject(session.tokenSet.idToken),
      user: session.user,
      createdAt: session.createdAt || session.tokenSet.obtainedAt,
    };
  }

  if (!("accessToken" in session)) {
    throw new Error("Stored app session is malformed.");
  }

  return createStoredAppSession({
    tokenSet: {
      accessToken: session.accessToken,
      tokenType: "Bearer",
      obtainedAt: session.createdAt,
    },
    target: session.target,
    user: session.user,
  });
}

export function saveAppSession(session: StoredAppSession): string {
  const storePath = getStorePath();
  ensureDir(path.dirname(storePath));
  writeFileAtomic(storePath, `${JSON.stringify(session, null, 2)}\n`);
  return storePath;
}

export function readAppSession(): StoredAppSession {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    throw new Error(
      "No stored app session found. Run `codey auth login` first.",
    );
  }
  return normalizeStoredAppSession(
    JSON.parse(fs.readFileSync(storePath, "utf8")) as
      | StoredAppSession
      | LegacyStoredAppSession,
  );
}

export function getAppSessionAccessToken(session: StoredAppSession): string {
  return session.tokenSet.accessToken;
}

export function isAppSessionExpired(
  session: StoredAppSession,
  skewMs = 30_000,
): boolean {
  if (!session.tokenSet.expiresAt) {
    return false;
  }
  return Date.parse(session.tokenSet.expiresAt) <= Date.now() + skewMs;
}

export function clearAppSession(): void {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    fs.rmSync(storePath);
  }
}
