import { createFileRoute } from "@tanstack/react-router";

import { getCliSessionUser } from "../../../../lib/server/auth";
import { getCliSub2ApiConfig } from "../../../../lib/server/external-service-configs";
import { json, text } from "../../../../lib/server/http";
import { NOTIFICATIONS_READ_SCOPE } from "../../../../lib/server/oauth-scopes";
import { getBearerTokenContext } from "../../../../lib/server/oauth-resource";

export const Route = createFileRoute("/api/cli/external-services/sub2api")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sessionUser = await getCliSessionUser(request);
        const bearerContext = await getBearerTokenContext(request);
        const serviceClientAuthorized =
          bearerContext?.kind === "client_credentials" &&
          bearerContext.scope.includes(NOTIFICATIONS_READ_SCOPE);

        if (!sessionUser && !serviceClientAuthorized) {
          return text("CLI authentication required", 401);
        }

        try {
          return json({
            config: await getCliSub2ApiConfig(),
          });
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : "Sub2API configuration is unavailable",
            404,
          );
        }
      },
    },
  },
});
