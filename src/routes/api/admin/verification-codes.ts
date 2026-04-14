import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "../../../lib/server/auth";
import { json, redirect, text } from "../../../lib/server/http";
import { createManualVerificationCode } from "../../../lib/server/verification";

export const Route = createFileRoute("/api/admin/verification-codes")({
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
        const email = String(form.get("email") || "");
        const code = String(form.get("code") || "");
        if (!email || !code) {
          return text("email and code are required", 400);
        }

        const record = await createManualVerificationCode({ email, code });
        const accept = request.headers.get("accept") || "";
        if (accept.includes("application/json")) {
          return json({ ok: true, id: record.id }, 201);
        }

        return redirect("/admin");
      },
    },
  },
});
