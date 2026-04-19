import { createFileRoute } from "@tanstack/react-router";
import { requireAdminPermission } from "../../../lib/server/auth";
import { json, text } from "../../../lib/server/http";
import { readJsonBody } from "../../../lib/server/request";
import {
  createVerificationDomain,
  listVerificationDomains,
} from "../../../lib/server/verification-domains";

interface CreateVerificationDomainBody {
  domain?: string;
  description?: string;
  enabled?: boolean;
  isDefault?: boolean;
}

export const Route = createFileRoute("/api/admin/verification-domains")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, "OAUTH_APPS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        return json({
          domains: await listVerificationDomains(),
        });
      },
      POST: async ({ request }) => {
        try {
          await requireAdminPermission(request, "OAUTH_APPS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const body = await readJsonBody<CreateVerificationDomainBody>(request);

        try {
          const domain = await createVerificationDomain({
            domain: String(body.domain || ""),
            description: String(body.description || "").trim() || undefined,
            enabled:
              typeof body.enabled === "boolean" ? body.enabled : undefined,
            isDefault:
              typeof body.isDefault === "boolean" ? body.isDefault : undefined,
          });

          return json({ domain }, 201);
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : "Unable to create verification domain",
            400,
          );
        }
      },
    },
  },
});
