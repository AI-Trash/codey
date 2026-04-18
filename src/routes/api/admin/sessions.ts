import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "../../../lib/server/auth";
import { json, redirect, text } from "../../../lib/server/http";
import {
  deleteManagedSession,
  findAdminManagedSessionSummary,
  updateManagedSessionStatus,
} from "../../../lib/server/managed-sessions";

function readRedirectTo(value: FormDataEntryValue | null): string | undefined {
  const redirectTo = String(value || "").trim();
  if (!redirectTo || !redirectTo.startsWith("/admin")) {
    return undefined;
  }

  return redirectTo;
}

function readIntent(value: FormDataEntryValue | null) {
  return String(value || "").trim().toLowerCase();
}

export const Route = createFileRoute("/api/admin/sessions")({
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
        const id = String(form.get("id") || "").trim();
        const intent = readIntent(form.get("intent"));

        if (!id) {
          return text("id is required", 400);
        }

        const knownSession = await findAdminManagedSessionSummary(id);
        if (!knownSession) {
          return text("Unknown session id", 400);
        }

        if (intent === "delete") {
          const record = await deleteManagedSession(id);
          if (!record) {
            return text("Unknown session id", 400);
          }

          const accept = request.headers.get("accept") || "";
          if (accept.includes("application/json")) {
            return json({ ok: true, id: record.id });
          }

          return redirect(
            readRedirectTo(form.get("redirectTo")) || "/admin/sessions",
          );
        }

        const record =
          intent === "activate"
            ? await updateManagedSessionStatus({
                id,
                status: "ACTIVE",
              })
            : intent === "revoke"
              ? await updateManagedSessionStatus({
                  id,
                  status: "REVOKED",
                })
              : null;

        if (!record) {
          return text("Unable to update managed session", 400);
        }

        const accept = request.headers.get("accept") || "";
        if (accept.includes("application/json")) {
          return json({ ok: true, id: record.id });
        }

        return redirect(readRedirectTo(form.get("redirectTo")) || "/admin/sessions");
      },
    },
  },
});
