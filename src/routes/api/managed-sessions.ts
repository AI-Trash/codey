import { createFileRoute } from "@tanstack/react-router";
import { syncManagedSession } from "../../lib/server/managed-sessions";
import { json, text } from "../../lib/server/http";
import { requireBearerToken } from "../../lib/server/oauth-resource";
import { VERIFICATION_RESERVE_SCOPE } from "../../lib/server/oauth-scopes";
import { readJsonBody } from "../../lib/server/request";

interface ManagedSessionSyncBody {
  identityId?: string;
  email?: string;
  authMode?: string;
  flowType?: string;
  accountId?: string;
  sessionId?: string;
  expiresAt?: string;
  lastRefreshAt?: string;
  sessionData?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const Route = createFileRoute("/api/managed-sessions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireBearerToken(request, {
            scopes: [VERIFICATION_RESERVE_SCOPE],
          });
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const body = await readJsonBody<ManagedSessionSyncBody>(request);
        const identityId = String(body.identityId || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const authMode = String(body.authMode || "").trim();
        const flowType = String(body.flowType || "").trim();

        if (!identityId || !email || !authMode || !flowType) {
          return text(
            "identityId, email, authMode, and flowType are required",
            400,
          );
        }

        if (!isRecord(body.sessionData)) {
          return text("sessionData must be an object", 400);
        }

        const record = await syncManagedSession({
          identityId,
          email,
          authMode,
          flowType,
          accountId: String(body.accountId || "").trim() || undefined,
          sessionId: String(body.sessionId || "").trim() || undefined,
          expiresAt: String(body.expiresAt || "").trim() || undefined,
          lastRefreshAt:
            String(body.lastRefreshAt || "").trim() || undefined,
          sessionData: body.sessionData,
        });

        return json({ ok: true, id: record.id });
      },
    },
  },
});
