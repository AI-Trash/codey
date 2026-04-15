import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "../../../lib/server/auth";
import {
  createOAuthClient,
  listOAuthClients,
} from "../../../lib/server/oauth-clients";
import { json, text } from "../../../lib/server/http";
import { readJsonBody } from "../../../lib/server/request";

interface CreateOAuthClientBody {
  clientName?: string;
  description?: string;
  allowedScopes?: string[];
  enabled?: boolean;
  clientCredentialsEnabled?: boolean;
  deviceFlowEnabled?: boolean;
  tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post";
}

export const Route = createFileRoute("/api/admin/oauth-clients")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        return json({
          clients: await listOAuthClients(),
        });
      },
      POST: async ({ request }) => {
        let admin;
        try {
          admin = await requireAdmin(request);
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const body = await readJsonBody<CreateOAuthClientBody>(request);

        try {
          const result = await createOAuthClient({
            clientName: String(body.clientName || "").trim(),
            description: String(body.description || "").trim() || undefined,
            allowedScopes: Array.isArray(body.allowedScopes)
              ? body.allowedScopes.map((scope) => String(scope))
              : undefined,
            enabled:
              typeof body.enabled === "boolean" ? body.enabled : undefined,
            clientCredentialsEnabled:
              typeof body.clientCredentialsEnabled === "boolean"
                ? body.clientCredentialsEnabled
                : undefined,
            deviceFlowEnabled:
              typeof body.deviceFlowEnabled === "boolean"
                ? body.deviceFlowEnabled
                : undefined,
            tokenEndpointAuthMethod:
              body.tokenEndpointAuthMethod === "client_secret_post"
                ? "client_secret_post"
                : body.tokenEndpointAuthMethod === "client_secret_basic"
                  ? "client_secret_basic"
                  : undefined,
            createdByUserId: admin.user.id,
          });

          return json(
            {
              client: result.client,
              clientSecret: result.clientSecret,
            },
            201,
          );
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unable to create OAuth client",
            400,
          );
        }
      },
    },
  },
});
