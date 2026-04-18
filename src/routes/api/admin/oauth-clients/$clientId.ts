import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "../../../../lib/server/auth";
import {
  getOAuthClientById,
  getOAuthClientSummaryById,
  updateOAuthClient,
} from "../../../../lib/server/oauth-clients";
import { json, text } from "../../../../lib/server/http";
import { readJsonBody } from "../../../../lib/server/request";

interface UpdateOAuthClientBody {
  clientName?: string;
  description?: string | null;
  allowedScopes?: string[];
  enabled?: boolean;
  verificationDomainId?: string;
  clientCredentialsEnabled?: boolean;
  deviceFlowEnabled?: boolean;
  tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post";
  rotateSecret?: boolean;
}

export const Route = createFileRoute("/api/admin/oauth-clients/$clientId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await requireAdmin(request);
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const includeSecret = new URL(request.url).searchParams.get("includeSecret") === "true";

        if (includeSecret) {
          const client = await getOAuthClientById(params.clientId);
          if (!client) {
            return text("OAuth client not found", 404);
          }

          return json({
            client,
            clientSecret:
              typeof client.oidc.client_secret === "string"
                ? client.oidc.client_secret
                : undefined,
          });
        }

        const client = await getOAuthClientSummaryById(params.clientId);
        if (!client) {
          return text("OAuth client not found", 404);
        }

        return json({ client });
      },
      PATCH: async ({ request, params }) => {
        let admin;
        try {
          admin = await requireAdmin(request);
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const body = await readJsonBody<UpdateOAuthClientBody>(request);
        try {
          const result = await updateOAuthClient(params.clientId, {
            clientName:
              typeof body.clientName === "string" ? body.clientName : undefined,
            description:
              typeof body.description === "string" || body.description === null
                ? body.description
                : undefined,
            allowedScopes: Array.isArray(body.allowedScopes)
              ? body.allowedScopes.map((scope) => String(scope))
              : undefined,
            enabled:
              typeof body.enabled === "boolean" ? body.enabled : undefined,
            verificationDomainId:
              typeof body.verificationDomainId === "string"
                ? body.verificationDomainId
                : undefined,
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
            rotateSecret:
              typeof body.rotateSecret === "boolean" ? body.rotateSecret : undefined,
            updatedByUserId: admin.user.id,
          });

          return json({
            client: result.client,
            rotatedSecret: result.rotatedSecret,
          });
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unable to update OAuth client",
            400,
          );
        }
      },
    },
  },
});
