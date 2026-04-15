import type { AppVerificationProviderConfig } from "../../config";
import { sleep } from "../../utils/wait";
import { ensureJson } from "../app-auth/http";
import {
  exchangeOidcClientCredentials,
  type OidcTokenSet,
} from "../app-auth/oidc";
import { streamSse } from "../app-auth/sse";
import type {
  VerificationEmailTarget,
  WaitForVerificationCodeOptions,
} from "./types";

export interface AppVerificationEmailReservation extends VerificationEmailTarget {
  reservationId: string;
  expiresAt?: string;
}

export interface AppVerificationCodeLookupResponse {
  reservationId?: string;
  status: "pending" | "resolved";
  code?: string;
  receivedAt?: string;
}

export interface AppVerificationEvent {
  type: "keepalive" | "verification_code";
  reservationId?: string;
  email?: string;
  code?: string;
  receivedAt?: string;
}

export class AppVerificationProviderClient {
  private tokenCache?: OidcTokenSet;

  constructor(private readonly config: AppVerificationProviderConfig = {}) {}

  private getBaseUrl(): string {
    const baseUrl = this.config.baseUrl?.trim();
    if (!baseUrl) {
      throw new Error(
        'verification.app.baseUrl is required when verification.provider is "app".',
      );
    }

    return baseUrl;
  }

  private invalidateCachedToken(): void {
    this.tokenCache = undefined;
  }

  private hasValidCachedToken(): boolean {
    if (!this.tokenCache?.accessToken) {
      return false;
    }
    if (!this.tokenCache.expiresAt) {
      return true;
    }
    return Date.parse(this.tokenCache.expiresAt) - Date.now() > 30_000;
  }

  private async getAccessToken(): Promise<string> {
    if (!this.hasValidCachedToken()) {
      this.tokenCache = await exchangeOidcClientCredentials({
        baseUrl: this.config.baseUrl,
        oidcIssuer: this.config.oidcIssuer,
        oidcBasePath: this.config.oidcBasePath,
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        scope: this.config.scope,
        resource: this.config.resource,
        tokenEndpointAuthMethod: this.config.tokenEndpointAuthMethod,
      });
    }

    if (!this.tokenCache?.accessToken) {
      throw new Error("Unable to acquire an OIDC access token for verification.");
    }

    return this.tokenCache.accessToken;
  }

  private async fetchWithAuthorization(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const runRequest = async (): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${await this.getAccessToken()}`);
      if (!headers.has("Accept")) {
        headers.set("Accept", "application/json");
      }
      return fetch(input, {
        ...init,
        headers,
      });
    };

    let response = await runRequest();
    if (response.status !== 401) {
      return response;
    }

    this.invalidateCachedToken();
    response = await runRequest();
    return response;
  }

  private buildUrl(pathname: string): string {
    const baseUrl = this.getBaseUrl();
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(pathname, normalizedBase).toString();
  }

  private async getJson<T>(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.fetchWithAuthorization(input, init);
    return ensureJson<T>(response);
  }

  async reserveEmailTarget(): Promise<AppVerificationEmailReservation> {
    const reserveUrl = this.buildUrl(
      this.config.reserveEmailPath || "/api/verification/email-reservations",
    );
    return this.getJson<AppVerificationEmailReservation>(reserveUrl, {
      method: "POST",
    });
  }

  async waitForVerificationCode(
    options: WaitForVerificationCodeOptions,
  ): Promise<string> {
    const codeUrl = new URL(
      this.buildUrl(
        this.config.verificationCodePath || "/api/verification/codes",
      ),
    );
    codeUrl.searchParams.set("email", options.email);
    codeUrl.searchParams.set("startedAt", options.startedAt);

    const deadline = Date.now() + options.timeoutMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt += 1;
      options.onPollAttempt?.(attempt);

      const result = await this.getJson<AppVerificationCodeLookupResponse>(
        codeUrl,
        {},
      );
      if (result.status === "resolved" && result.code) {
        return result.code;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }

      await sleep(Math.min(options.pollIntervalMs, remainingMs));
    }

    throw new Error(
      `Timed out waiting for a verification code sent to ${options.email}.`,
    );
  }

  async *streamVerificationEvents(params: {
    email: string;
    startedAt: string;
  }): AsyncGenerator<AppVerificationEvent, void, void> {
    const eventsUrl = new URL(
      this.buildUrl(
        this.config.verificationEventsPath || "/api/verification/events",
      ),
    );
    eventsUrl.searchParams.set("email", params.email);
    eventsUrl.searchParams.set("startedAt", params.startedAt);
    const response = await this.fetchWithAuthorization(eventsUrl, {
      headers: {
        Accept: "text/event-stream",
      },
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    for await (const event of streamSse(response)) {
      if (event.event === "verification_code" && event.data) {
        const payload = JSON.parse(
          event.data,
        ) as AppVerificationCodeLookupResponse;
        yield {
          type: "verification_code",
          reservationId: payload.reservationId,
          email: params.email,
          code: payload.code,
          receivedAt: payload.receivedAt,
        };
        continue;
      }

      yield {
        type: "keepalive",
        email: params.email,
      };
    }
  }
}
