import "@tanstack/react-start/server-only";
import { getAppEnv } from "./env";
import { prisma } from "./prisma";
import { randomToken } from "./security";

interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}

export interface GitHubStatePayload {
  redirectTo: string;
}

function encodeState(payload: GitHubStatePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(state: string): GitHubStatePayload {
  const parsed = JSON.parse(
    Buffer.from(state, "base64url").toString("utf8"),
  ) as {
    redirectTo?: string;
  };
  return {
    redirectTo: parsed.redirectTo || "/admin",
  };
}

export function buildGitHubAuthorizeUrl(
  request: Request,
  redirectTo = "/admin",
): string {
  const env = getAppEnv();
  if (!env.githubClientId) {
    throw new Error("GITHUB_CLIENT_ID is required to start GitHub OAuth");
  }

  const callbackUrl = new URL(
    "/auth/github/callback",
    resolveBaseUrl(request),
  ).toString();
  const state = encodeState({ redirectTo });
  const nonce = randomToken(16);
  const url = new URL(env.githubAuthorizeUrl);
  url.searchParams.set("client_id", env.githubClientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("scope", env.githubScope);
  url.searchParams.set("state", state);
  url.searchParams.set("login", "");
  url.searchParams.set("allow_signup", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("nonce", nonce);
  return url.toString();
}

export function resolveBaseUrl(request: Request): string {
  const env = getAppEnv();
  if (env.appBaseUrl) return env.appBaseUrl;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function exchangeGitHubCode(request: Request, code: string) {
  const env = getAppEnv();
  if (!env.githubClientId || !env.githubClientSecret) {
    throw new Error("GitHub OAuth is not configured");
  }

  const callbackUrl = new URL(
    "/auth/github/callback",
    resolveBaseUrl(request),
  ).toString();
  const response = await fetch(env.githubTokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "codey-app",
    },
    body: JSON.stringify({
      client_id: env.githubClientId,
      client_secret: env.githubClientSecret,
      code,
      redirect_uri: callbackUrl,
    }),
  });

  const tokenPayload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !tokenPayload.access_token) {
    throw new Error(
      tokenPayload.error_description ||
        tokenPayload.error ||
        "Failed to exchange GitHub code",
    );
  }

  const userResponse = await fetch(env.githubUserUrl, {
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "codey-app",
    },
  });
  const userPayload = (await userResponse.json()) as GitHubUserResponse;

  if (!userResponse.ok || !userPayload.id) {
    throw new Error("Failed to load GitHub user profile");
  }

  const existingUsers = await prisma.user.count();
  const user = await prisma.user.upsert({
    where: {
      githubId: String(userPayload.id),
    },
    update: {
      email: userPayload.email || undefined,
      githubLogin: userPayload.login,
      name: userPayload.name || undefined,
      avatarUrl: userPayload.avatar_url || undefined,
    },
    create: {
      githubId: String(userPayload.id),
      email: userPayload.email || undefined,
      githubLogin: userPayload.login,
      name: userPayload.name || undefined,
      avatarUrl: userPayload.avatar_url || undefined,
      role: existingUsers === 0 ? "ADMIN" : "USER",
    },
  });

  return {
    user,
  };
}

export function readGitHubState(state: string | null): GitHubStatePayload {
  if (!state) {
    return { redirectTo: "/admin" };
  }

  return decodeState(state);
}
