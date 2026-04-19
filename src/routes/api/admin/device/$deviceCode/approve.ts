import { createFileRoute } from "@tanstack/react-router";
import { approveDeviceChallenge } from "../../../../../lib/server/device-auth";
import { requireAdminPermission } from "../../../../../lib/server/auth";
import { json, redirect, text } from "../../../../../lib/server/http";

export const Route = createFileRoute("/api/admin/device/$deviceCode/approve")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let admin;
        try {
          admin = await requireAdminPermission(request, "CLI_OPERATIONS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const form = await request.formData();
        const approvalMessage =
          String(form.get("approvalMessage") || "") || undefined;
        const result = await approveDeviceChallenge({
          deviceCode: params.deviceCode,
          userId: admin.user.id,
          approvalMessage,
        });

        const accept = request.headers.get("accept") || "";
        if (accept.includes("application/json")) {
          return json({ ok: true, deviceCode: result.challenge.deviceCode });
        }

        return redirect("/admin");
      },
    },
  },
});
