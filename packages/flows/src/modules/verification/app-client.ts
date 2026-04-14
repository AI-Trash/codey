import type { AppVerificationProviderConfig } from "../../config";
import { ensureJson } from "../app-auth/http";
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

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    const apiKey = this.config.apiKey?.trim();
    if (apiKey) {
      headers[this.config.apiKeyHeader || "x-codey-api-key"] = apiKey;
    }
    return headers;
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
    const response = await fetch(input, init);
    return ensureJson<T>(response);
  }

  async reserveEmailTarget(): Promise<AppVerificationEmailReservation> {
    const reserveUrl = this.buildUrl(
      this.config.reserveEmailPath || "/api/verification/email-reservations",
    );
    return this.getJson<AppVerificationEmailReservation>(reserveUrl, {
      method: "POST",
      headers: this.getHeaders(),
    });
  }

  async waitForVerificationCode(
    options: WaitForVerificationCodeOptions,
  ): Promise<string> {
    for await (const event of this.streamVerificationEvents({
      email: options.email,
      startedAt: options.startedAt,
    })) {
      if (event.type === "verification_code" && event.code) {
        return event.code;
      }
    }

    const codeUrl = new URL(
      this.buildUrl(
        this.config.verificationCodePath || "/api/verification/codes",
      ),
    );
    codeUrl.searchParams.set("email", options.email);
    codeUrl.searchParams.set("startedAt", options.startedAt);
    const result = await this.getJson<AppVerificationCodeLookupResponse>(
      codeUrl,
      {
        headers: this.getHeaders(),
      },
    );
    if (result.status === "resolved" && result.code) {
      return result.code;
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
    const response = await fetch(eventsUrl, {
      headers: {
        ...this.getHeaders(),
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
