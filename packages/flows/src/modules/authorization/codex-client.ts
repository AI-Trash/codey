import { spawn } from "child_process";
import {
  buildAuthorizationUrl,
  waitForAuthorizationCode,
} from "./codex-authorization";

export interface CodexTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
  createdAt: string;
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

export async function runCodexAuthorization(input: {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  redirectHost?: string;
  redirectPort?: number;
  redirectPath?: string;
  openBrowserWindow?: boolean;
}): Promise<CodexTokenResponse> {
  const redirectHost = input.redirectHost || "127.0.0.1";
  const redirectPort = input.redirectPort || 3000;
  const redirectPath = input.redirectPath || "/callback";
  const redirectUri = `http://${redirectHost}:${redirectPort}${redirectPath}`;
  const authorization = buildAuthorizationUrl({
    authorizeUrl: input.authorizeUrl,
    clientId: input.clientId,
    redirectUri,
    scope: input.scope,
    pkce: true,
  });

  if (input.openBrowserWindow !== false) {
    openBrowser(authorization.authorizationUrl);
  }

  const callback = await waitForAuthorizationCode({
    host: redirectHost,
    port: redirectPort,
    path: redirectPath,
  });

  const response = await fetch(input.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.code || "",
      redirect_uri: redirectUri,
      client_id: input.clientId,
      ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
      ...(authorization.codeVerifier
        ? { code_verifier: authorization.codeVerifier }
        : {}),
    }),
  });

  const tokenPayload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !tokenPayload.access_token) {
    throw new Error(
      tokenPayload.error_description ||
        tokenPayload.error ||
        "Codex token exchange failed.",
    );
  }

  return {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresIn: tokenPayload.expires_in,
    scope: tokenPayload.scope,
    tokenType: tokenPayload.token_type,
    createdAt: new Date().toISOString(),
  };
}
