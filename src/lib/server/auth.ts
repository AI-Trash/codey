import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import { getAppEnv } from "./env";
import { getDb } from "./db/client";
import { sessions } from "./db/schema";
import { getBearerTokenContext } from "./oauth-resource";
import { createId, randomToken, sha256 } from "./security";

export interface SessionUser {
  user: {
    id: string;
    email: string | null;
    githubId: string | null;
    githubLogin: string | null;
    name: string | null;
    avatarUrl: string | null;
    role: "ADMIN" | "USER";
    createdAt: Date;
    updatedAt: Date;
  };
  session: {
    id: string;
    tokenHash: string;
    kind: "BROWSER" | "CLI";
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    lastSeenAt: Date;
  };
}

function getExpiresAt(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function createBrowserSession(userId: string): Promise<{
  token: string;
  session: SessionUser["session"];
}> {
  const env = getAppEnv();
  const token = randomToken();
  const [session] = await getDb()
    .insert(sessions)
    .values({
      id: createId(),
      userId,
      kind: "BROWSER",
      tokenHash: sha256(token),
      expiresAt: getExpiresAt(env.sessionTtlDays),
    })
    .returning();

  return { token, session };
}

export function buildSessionCookie(token: string): string {
  const env = getAppEnv();
  const maxAge = env.sessionTtlDays * 24 * 60 * 60;
  return [
    `${env.sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  const env = getAppEnv();
  return [
    `${env.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

function readCookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  const items = raw.split(";").map((entry) => entry.trim());
  for (const item of items) {
    const [key, ...rest] = item.split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
}

function readBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;
  return token.trim();
}

export async function getSessionUser(
  request: Request,
): Promise<SessionUser | null> {
  const env = getAppEnv();
  const token = readCookieValue(request, env.sessionCookieName);
  if (!token) return null;

  const session = await getDb().query.sessions.findFirst({
    where: eq(sessions.tokenHash, sha256(token)),
    with: {
      user: true,
    },
  });

  if (!session || !session.user || session.kind !== "BROWSER") return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await getDb().delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }

  await getDb()
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, session.id));

  return {
    user: session.user,
    session,
  };
}

export async function requireSessionUser(
  request: Request,
): Promise<SessionUser> {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    throw new Error("Authentication required");
  }

  return sessionUser;
}

export async function requireAdmin(request: Request): Promise<SessionUser> {
  const sessionUser = await requireSessionUser(request);
  if (sessionUser.user.role !== "ADMIN") {
    throw new Error("Admin access required");
  }

  return sessionUser;
}

export async function getCliSessionUser(
  request: Request,
): Promise<SessionUser | null> {
  const oidcBearer = await getBearerTokenContext(request);
  if (oidcBearer?.accountId) {
    const user = await getDb().query.users.findFirst({
      where: (users, { eq: eqOperator }) =>
        eqOperator(users.id, oidcBearer.accountId as string),
    });

    if (user) {
      return {
        user,
        session: {
          id: `oidc:${oidcBearer.clientId}`,
          tokenHash: "",
          kind: "CLI",
          userId: user.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          createdAt: new Date(),
          lastSeenAt: new Date(),
        },
      };
    }
  }

  const token = readBearerToken(request);
  if (!token) return null;

  const session = await getDb().query.sessions.findFirst({
    where: eq(sessions.tokenHash, sha256(token)),
    with: {
      user: true,
    },
  });

  if (!session || !session.user || session.kind !== "CLI") return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await getDb().delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }

  await getDb()
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, session.id));

  return {
    user: session.user,
    session,
  };
}

export async function requireCliSessionUser(
  request: Request,
): Promise<SessionUser> {
  const sessionUser = await getCliSessionUser(request);
  if (!sessionUser) {
    throw new Error("CLI authentication required");
  }

  return sessionUser;
}

export async function destroyBrowserSession(request: Request): Promise<void> {
  const env = getAppEnv();
  const token = readCookieValue(request, env.sessionCookieName);
  if (!token) return;

  await getDb()
    .delete(sessions)
    .where(eq(sessions.tokenHash, sha256(token)));
}
