import { createFileRoute } from "@tanstack/react-router";
import { requireAdminPermission } from "../../../../../lib/server/auth";
import { json, text } from "../../../../../lib/server/http";
import { dispatchCliFlowTask } from "../../../../../lib/server/cli-tasks";

export const Route = createFileRoute(
  "/api/admin/cli-connections/$connectionId/tasks",
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          await requireAdminPermission(request, "OPERATIONS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Admin access required",
            401,
          );
        }

        let body: Record<string, unknown> | null = null;
        try {
          const parsed = await request.json();
          body =
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : null;
        } catch {
          return text("Invalid JSON body", 400);
        }

        const flowId =
          typeof body?.flowId === "string" ? body.flowId.trim() : "";
        if (!flowId) {
          return text("flowId is required", 400);
        }

        try {
          const result = await dispatchCliFlowTask({
            connectionId: params.connectionId,
            flowId,
            options:
              body?.options &&
              typeof body.options === "object" &&
              !Array.isArray(body.options)
                ? (body.options as Record<string, unknown>)
                : null,
          });

          return json(
            {
              ok: true,
              notificationId: result.notification.id,
              connectionId: result.connection.id,
              flowId,
              options: result.options,
            },
            201,
          );
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unable to dispatch flow task",
            400,
          );
        }
      },
    },
  },
});
