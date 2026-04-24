import { createFileRoute } from "@tanstack/react-router";

import { requireAdminPermission } from "../../../../lib/server/auth";
import { json, text } from "../../../../lib/server/http";
import {
  getSub2ApiServiceSummary,
  upsertSub2ApiServiceConfig,
} from "../../../../lib/server/external-service-configs";
import { readJsonBody } from "../../../../lib/server/request";

interface UpdateSub2ApiServiceBody {
  enabled?: boolean;
  baseUrl?: string | null;
  authMode?: "api_key" | "bearer_token" | "password";
  apiKey?: string | null;
  bearerToken?: string | null;
  email?: string | null;
  password?: string | null;
  loginPath?: string | null;
  refreshTokenPath?: string | null;
  accountsPath?: string | null;
  clientId?: string | null;
  proxyId?: number | null;
  concurrency?: number | null;
  priority?: number | null;
  groupIds?: number[] | null;
  autoFillRelatedModels?: boolean | null;
  confirmMixedChannelRisk?: boolean | null;
  openaiOAuthResponsesWebSocketV2Mode?: string | null;
}

function readOptionalInteger(
  value: unknown,
): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  throw new Error("Expected a whole number.");
}

function readOptionalIntegerArray(
  value: unknown,
): number[] | null | undefined {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("groupIds must be an array of whole numbers.");
  }

  const parsed = value
    .map((entry) => {
      if (typeof entry === "number" && Number.isInteger(entry)) {
        return entry;
      }

      if (typeof entry === "string") {
        const next = Number.parseInt(entry, 10);
        if (Number.isInteger(next)) {
          return next;
        }
      }

      return undefined;
    })
    .filter((entry): entry is number => Number.isInteger(entry));

  return parsed;
}

function readOpenAIWSMode(value: unknown) {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  if (value === "off" || value === "ctx_pool" || value === "passthrough") {
    return value;
  }

  throw new Error("openaiOAuthResponsesWebSocketV2Mode must be off, ctx_pool, or passthrough.");
}

export const Route = createFileRoute("/api/admin/external-services/sub2api")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, "OAUTH_CLIENTS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        return json({
          service: await getSub2ApiServiceSummary(),
        });
      },
      PATCH: async ({ request }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>;
        try {
          admin = await requireAdminPermission(request, "OAUTH_CLIENTS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const body = await readJsonBody<UpdateSub2ApiServiceBody>(request);

        try {
          const service = await upsertSub2ApiServiceConfig({
            enabled:
              typeof body.enabled === "boolean" ? body.enabled : undefined,
            baseUrl:
              typeof body.baseUrl === "string" || body.baseUrl === null
                ? body.baseUrl
                : undefined,
            authMode:
              body.authMode === "api_key"
                ? "api_key"
                : body.authMode === "password"
                ? "password"
                : body.authMode === "bearer_token"
                  ? "bearer_token"
                  : undefined,
            apiKey:
              typeof body.apiKey === "string" || body.apiKey === null
                ? body.apiKey
                : undefined,
            bearerToken:
              typeof body.bearerToken === "string" || body.bearerToken === null
                ? body.bearerToken
                : undefined,
            email:
              typeof body.email === "string" || body.email === null
                ? body.email
                : undefined,
            password:
              typeof body.password === "string" || body.password === null
                ? body.password
                : undefined,
            loginPath:
              typeof body.loginPath === "string" || body.loginPath === null
                ? body.loginPath
                : undefined,
            refreshTokenPath:
              typeof body.refreshTokenPath === "string" ||
              body.refreshTokenPath === null
                ? body.refreshTokenPath
                : undefined,
            accountsPath:
              typeof body.accountsPath === "string" || body.accountsPath === null
                ? body.accountsPath
                : undefined,
            clientId:
              typeof body.clientId === "string" || body.clientId === null
                ? body.clientId
                : undefined,
            proxyId: readOptionalInteger(body.proxyId),
            concurrency: readOptionalInteger(body.concurrency),
            priority: readOptionalInteger(body.priority),
            groupIds: readOptionalIntegerArray(body.groupIds),
            autoFillRelatedModels:
              typeof body.autoFillRelatedModels === "boolean" ||
              body.autoFillRelatedModels === null
                ? body.autoFillRelatedModels
                : undefined,
            confirmMixedChannelRisk:
              typeof body.confirmMixedChannelRisk === "boolean" ||
              body.confirmMixedChannelRisk === null
                ? body.confirmMixedChannelRisk
                : undefined,
            openaiOAuthResponsesWebSocketV2Mode: readOpenAIWSMode(
              body.openaiOAuthResponsesWebSocketV2Mode,
            ),
            updatedByUserId: admin.user.id,
          });

          return json({ service });
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : "Unable to save Sub2API configuration",
            400,
          );
        }
      },
    },
  },
});
