import { createFileRoute } from "@tanstack/react-router";
import {
  listManagedIdentityCredentialSummaries,
  resolveManagedIdentityCredential,
  syncManagedIdentity,
} from "../../lib/server/identities";
import { json, text } from "../../lib/server/http";
import { requireBearerToken } from "../../lib/server/oauth-resource";
import { VERIFICATION_RESERVE_SCOPE } from "../../lib/server/oauth-scopes";
import { readJsonBody } from "../../lib/server/request";

interface ManagedIdentitySyncBody {
  identityId?: string;
  email?: string;
  label?: string;
  password?: string;
  metadata?: Record<string, unknown>;
  credentialCount?: number;
  reservationId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const Route = createFileRoute("/api/managed-identities")({
  server: {
    handlers: {
      GET: async ({ request }) => {
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

        const url = new URL(request.url);
        const list = url.searchParams.get("list");
        if (list === "1" || list === "true") {
          const identities = await listManagedIdentityCredentialSummaries();
          return json({ identities });
        }

        const identity = await resolveManagedIdentityCredential({
          identityId: url.searchParams.get("identityId") || undefined,
          email: url.searchParams.get("email") || undefined,
        });

        if (!identity) {
          return text("Managed identity not found", 404);
        }

        return json({ identity });
      },
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

        const body = await readJsonBody<ManagedIdentitySyncBody>(request);
        const identityId = String(body.identityId || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const credentialCount =
          body.credentialCount === undefined || body.credentialCount === null
            ? undefined
            : Number(body.credentialCount);

        if (!identityId || !email) {
          return text("identityId and email are required", 400);
        }
        if (
          credentialCount !== undefined &&
          (!Number.isInteger(credentialCount) || credentialCount < 0)
        ) {
          return text("credentialCount must be a non-negative integer", 400);
        }
        if (body.metadata !== undefined && !isRecord(body.metadata)) {
          return text("metadata must be an object", 400);
        }

        const record = await syncManagedIdentity({
          identityId,
          email,
          label: String(body.label || "").trim() || undefined,
          password: String(body.password || "").trim() || undefined,
          metadata: body.metadata,
          credentialCount,
          reservationId: String(body.reservationId || "").trim() || undefined,
        });

        return json({ ok: true, id: record.id });
      },
    },
  },
});
