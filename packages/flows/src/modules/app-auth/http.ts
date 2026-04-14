import { getRuntimeConfig } from "../../config";

export function resolveAppBaseUrl(): string {
  const config = getRuntimeConfig();
  const baseUrl = config.app?.baseUrl || config.verification?.app?.baseUrl;
  if (!baseUrl) {
    throw new Error(
      "APP_BASE_URL is required for app-backed auth and SSE features.",
    );
  }
  return baseUrl;
}

export function resolveAppUrl(pathname: string): string {
  const baseUrl = resolveAppBaseUrl();
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(pathname, normalizedBase).toString();
}

export async function ensureJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}
