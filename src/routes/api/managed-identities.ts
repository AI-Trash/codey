import { createFileRoute } from "@tanstack/react-router";
import { syncManagedIdentity } from "../../lib/server/identities";
import { json, text } from "../../lib/server/http";
import { requireBearerToken } from "../../lib/server/oauth-resource";
import { VERIFICATION_RESERVE_SCOPE } from "../../lib/server/oauth-scopes";
import { readJsonBody } from "../../lib/server/request";

interface ManagedIdentitySyncBody {
  identityId?: string;
  email?: string;
  label?: string;
  credentialCount?: number;
  reservationId?: string;
}

export const Route = createFileRoute("/api/managed-identities")({
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

        const record = await syncManagedIdentity({
          identityId,
          email,
          label: String(body.label || "").trim() || undefined,
          credentialCount,
          reservationId: String(body.reservationId || "").trim() || undefined,
        });

        return json({ ok: true, id: record.id });
      },
    },
  },
});
