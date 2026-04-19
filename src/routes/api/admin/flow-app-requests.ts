import { createFileRoute } from "@tanstack/react-router";
import { createFlowAppRequest } from "../../../lib/server/admin";
import { requireAdminPermission } from "../../../lib/server/auth";
import { json, redirect, text } from "../../../lib/server/http";

export const Route = createFileRoute("/api/admin/flow-app-requests")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let admin;
        try {
          admin = await requireAdminPermission(request, "OPERATIONS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const form = await request.formData();
        const appName = String(form.get("appName") || "").trim();
        if (!appName) {
          return text("appName is required", 400);
        }

        const record = await createFlowAppRequest({
          appName,
          flowType: String(form.get("flowType") || "").trim() || undefined,
          requestedBy:
            admin.user.githubLogin || admin.user.email || admin.user.name || undefined,
          requestedIdentity:
            String(form.get("requestedIdentity") || "").trim() || undefined,
          notes: String(form.get("notes") || "").trim() || undefined,
        });

        const accept = request.headers.get("accept") || "";
        if (accept.includes("application/json")) {
          return json({ ok: true, id: record.id }, 201);
        }

        return redirect("/admin");
      },
    },
  },
});
