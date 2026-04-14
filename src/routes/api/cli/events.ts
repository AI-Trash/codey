import { createFileRoute } from "@tanstack/react-router";
import { listCliNotifications } from "../../../lib/server/admin";
import { requireCliSessionUser } from "../../../lib/server/auth";
import { text } from "../../../lib/server/http";
import { createPollingSseResponse } from "../../../lib/server/sse";

export const Route = createFileRoute("/api/cli/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let sessionUser;
        try {
          sessionUser = await requireCliSessionUser(request);
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const url = new URL(request.url);
        const target =
          url.searchParams.get("target") ||
          sessionUser.user.githubLogin ||
          sessionUser.user.email ||
          undefined;
        let cursor = url.searchParams.get("after")
          ? new Date(url.searchParams.get("after") as string)
          : new Date();

        return createPollingSseResponse({
          intervalMs: 2000,
          timeoutMs: 10 * 60 * 1000,
          loadEvent: async () => {
            const notifications = await listCliNotifications({
              target,
              after: cursor,
            });

            if (!notifications.length) return null;
            const next = notifications[0];
            cursor = next.createdAt;
            return {
              id: next.id,
              event: "admin_notification",
              data: {
                id: next.id,
                title: next.title,
                body: next.body,
                flowType: next.flowType,
                target: next.target,
                createdAt: next.createdAt.toISOString(),
              },
            };
          },
        });
      },
    },
  },
});
