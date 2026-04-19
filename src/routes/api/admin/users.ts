import { createFileRoute } from "@tanstack/react-router";
import { normalizeAdminPermissions } from "../../../lib/admin-access";
import { requireAdminPermission } from "../../../lib/server/auth";
import { json, redirect, text } from "../../../lib/server/http";
import { updateAdminUserPermissions } from "../../../lib/server/users";

function readRedirectTo(value: FormDataEntryValue | null): string | undefined {
  const redirectTo = String(value || "").trim();
  if (!redirectTo || !redirectTo.startsWith("/admin")) {
    return undefined;
  }

  return redirectTo;
}

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let admin;
        try {
          admin = await requireAdminPermission(request, "USERS");
        } catch (error) {
          return text(
            error instanceof Error ? error.message : "Unauthorized",
            401,
          );
        }

        const form = await request.formData();
        const userId = String(form.get("userId") || "").trim();

        if (!userId) {
          return text("userId is required", 400);
        }

        try {
          const result = await updateAdminUserPermissions({
            actorUserId: admin.user.id,
            targetUserId: userId,
            permissions: normalizeAdminPermissions(
              form.getAll("permissions").map((value) => String(value)),
            ),
          });

          const accept = request.headers.get("accept") || "";
          if (accept.includes("application/json")) {
            return json({ ok: true, user: result.user, policy: result.policy });
          }

          return redirect(readRedirectTo(form.get("redirectTo")) || "/admin/users");
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : "Unable to update user permissions",
            400,
          );
        }
      },
    },
  },
});
