import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "../../../lib/server/auth";
import { json, redirect, text } from "../../../lib/server/http";
import {
  findAdminIdentitySummary,
  upsertManagedIdentity,
} from "../../../lib/server/identities";

function readManagedIdentityStatus(
  value: FormDataEntryValue | null,
): "ACTIVE" | "REVIEW" | "ARCHIVED" {
  const normalized = String(value || "ACTIVE").toUpperCase();
  if (
    normalized === "ACTIVE" ||
    normalized === "REVIEW" ||
    normalized === "ARCHIVED"
  ) {
    return normalized;
  }

  return "ACTIVE";
}

function readRedirectTo(value: FormDataEntryValue | null): string | undefined {
  const redirectTo = String(value || "").trim();
  if (!redirectTo || !redirectTo.startsWith("/admin")) {
    return undefined;
  }

  return redirectTo;
}

export const Route = createFileRoute("/api/admin/identities")({
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
        const identityId = String(form.get("identityId") || "").trim();
        const email = String(form.get("email") || "").trim();

        if (!identityId || !email) {
          return text("identityId and email are required", 400);
        }

        const knownIdentity = await findAdminIdentitySummary(identityId);
        if (!knownIdentity) {
          return text("Unknown identityId", 400);
        }

        if (knownIdentity.account !== email) {
          return text("Identity email mismatch", 400);
        }

        const record = await upsertManagedIdentity({
          identityId,
          email,
          label: String(form.get("label") || ""),
          status: readManagedIdentityStatus(form.get("status")),
        });

        const accept = request.headers.get("accept") || "";
        if (accept.includes("application/json")) {
          return json({ ok: true, id: record.id });
        }

        return redirect(readRedirectTo(form.get("redirectTo")) || "/admin#overview");
      },
    },
  },
});
