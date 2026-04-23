import { createFileRoute } from "@tanstack/react-router";

import { text } from "../../../../lib/server/http";

export const Route = createFileRoute("/api/cli/external-services/sub2api")({
  server: {
    handlers: {
      GET: async () => {
        return text(
          "Sub2API credentials are no longer exposed to CLI clients. Codey Web now performs Sub2API sync server-side.",
          410,
        );
      },
    },
  },
});
