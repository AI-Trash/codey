import { createFileRoute } from "@tanstack/react-router";
import { createAdminNotification } from "../../../lib/server/admin";
import { requireAdmin } from "../../../lib/server/auth";
import { json, redirect, text } from "../../../lib/server/http";

export const Route = createFileRoute("/api/admin/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdmin(request);
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const form = await request.formData();
        await createAdminNotification({
          title: String(form.get("title") || ""),
          body: String(form.get("body") || ""),
          flowType: String(form.get("flowType") || "") || undefined,
          target: String(form.get("target") || "") || undefined,
        });

        const accept = request.headers.get("accept") || "";
        if (accept.includes("application/json")) {
          return json({ ok: true }, 201);
        }

        return redirect("/admin");
      },
    },
  },
});
