import { createFileRoute } from "@tanstack/react-router";
import { requireAdminPermission } from "../../../lib/server/auth";
import { json, text } from "../../../lib/server/http";
import { listAdminCliConnectionState } from "../../../lib/server/cli-connections";

export const Route = createFileRoute("/api/admin/cli-connections")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, "OPERATIONS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Admin access required",
            401,
          );
        }

        return json(await listAdminCliConnectionState());
      },
    },
  },
});
