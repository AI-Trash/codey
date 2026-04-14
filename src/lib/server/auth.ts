import "@tanstack/react-start/server-only";
import { getAppEnv } from "./env";
import { prisma } from "./prisma";
import { randomToken, sha256 } from "./security";

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
  const session = await prisma.session.create({
    data: {
      userId,
      kind: "BROWSER",
      tokenHash: sha256(token),
      expiresAt: getExpiresAt(env.sessionTtlDays),
    },
  });

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

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: sha256(token),
    },
    include: {
      user: true,
    },
  });

  if (!session || session.kind !== "BROWSER") return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

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
  const token = readBearerToken(request);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: sha256(token),
    },
    include: {
      user: true,
    },
  });

  if (!session || session.kind !== "CLI") return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

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

  await prisma.session.deleteMany({
    where: {
      tokenHash: sha256(token),
    },
  });
}
