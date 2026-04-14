import "@tanstack/react-start/server-only";

import { getAppEnv } from "./env";
import { text } from "./http";

export async function readJsonBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

export function getSearchParam(request: Request, key: string): string | null {
  return new URL(request.url).searchParams.get(key);
}

export function requireVerificationApiKey(request: Request): Response | null {
  const env = getAppEnv();
  if (!env.verificationApiKey) {
    return null;
  }

  const provided = request.headers.get(env.verificationApiKeyHeader);
  if (provided !== env.verificationApiKey) {
    return text("Invalid verification API key", 401);
  }

  return null;
}
