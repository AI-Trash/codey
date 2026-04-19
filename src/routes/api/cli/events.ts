import { createFileRoute } from "@tanstack/react-router";
import { listCliNotifications } from "../../../lib/server/admin";
import { requireCliSessionUser } from "../../../lib/server/auth";
import { text } from "../../../lib/server/http";
import { getBearerTokenContext } from "../../../lib/server/oauth-resource";
import {
  markCliConnectionDisconnected,
  registerCliConnection,
  touchCliConnection,
} from "../../../lib/server/cli-connections";
import { createSubscriptionSseResponse } from "../../../lib/server/sse";

const CLI_EVENT_POLL_INTERVAL_MS = 2000;
const CLI_EVENT_TIMEOUT_MS = 10 * 60 * 1000;
const CLI_CONNECTION_TOUCH_INTERVAL_MS = 10_000;

function readOptionalHeader(request: Request, name: string): string | undefined {
  const value = request.headers.get(name);
  const normalized = value?.trim();
  return normalized || undefined;
}

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
        const cliName =
          url.searchParams.get("cliName") ||
          readOptionalHeader(request, "x-codey-cli-name") ||
          "codey";
        const bearerContext = await getBearerTokenContext(request);
        let cursor = url.searchParams.get("after")
          ? new Date(url.searchParams.get("after") as string)
          : new Date();

        return createSubscriptionSseResponse({
          request,
          subscribe: async ({ send, close }) => {
            const connection = await registerCliConnection({
              sessionRef: sessionUser.session.id,
              userId: sessionUser.user.id,
              authClientId:
                bearerContext?.clientId ||
                (sessionUser.session.id.startsWith("oidc:")
                  ? sessionUser.session.id.slice("oidc:".length)
                  : null),
              cliName,
              target,
              userAgent: readOptionalHeader(request, "user-agent"),
              connectionPath: "/api/cli/events",
            });

            let closed = false;
            let ticking = false;
            let lastTouchedAt = 0;

            const touchConnection = async (force = false) => {
              const now = Date.now();
              if (!force && now - lastTouchedAt < CLI_CONNECTION_TOUCH_INTERVAL_MS) {
                return;
              }

              lastTouchedAt = now;
              await touchCliConnection(connection.id);
            };

            const runTick = async () => {
              if (closed || ticking) {
                return;
              }

              ticking = true;
              try {
                await touchConnection();

                const notifications = await listCliNotifications({
                  target,
                  after: cursor,
                });

                if (!notifications.length) {
                  return;
                }

                const next = notifications[0];
                cursor = next.createdAt;
                await touchConnection(true);
                send({
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
                });
              } finally {
                ticking = false;
              }
            };

            const interval = setInterval(() => {
              void runTick().catch(() => {
                close();
              });
            }, CLI_EVENT_POLL_INTERVAL_MS);

            const timeout = setTimeout(() => {
              if (closed) {
                return;
              }

              send({
                event: "timeout",
                data: { status: "timeout" },
              });
              close();
            }, CLI_EVENT_TIMEOUT_MS);

            try {
              await touchConnection(true);
              await runTick();
            } catch (error) {
              closed = true;
              clearInterval(interval);
              clearTimeout(timeout);
              await markCliConnectionDisconnected(connection.id);
              throw error;
            }

            return () => {
              if (closed) {
                return;
              }

              closed = true;
              clearInterval(interval);
              clearTimeout(timeout);
              void markCliConnectionDisconnected(connection.id);
            };
          },
        });
      },
    },
  },
});
