import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "../../../lib/server/auth";
import { json, redirect, text } from "../../../lib/server/http";
import {
  deleteManagedIdentity,
  findAdminIdentitySummary,
  updateManagedIdentity,
  upsertManagedIdentity,
} from "../../../lib/server/identities";

function readManagedIdentityPlan(
  value: FormDataEntryValue | null,
): "free" | "plus" | "team" {
  const normalized = String(value || "free").trim().toLowerCase();
  if (
    normalized === "free" ||
    normalized === "plus" ||
    normalized === "team"
  ) {
    return normalized;
  }

  return "free";
}

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

function readManagedIdentityIntent(value: FormDataEntryValue | null) {
  return String(value || "").trim().toLowerCase();
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
        const intent = readManagedIdentityIntent(form.get("intent"));

        if (!identityId) {
          return text("identityId is required", 400);
        }

        const knownIdentity = await findAdminIdentitySummary(identityId);
        if (!knownIdentity) {
          return text("Unknown identityId", 400);
        }

        if (email && knownIdentity.account !== email) {
          return text("Identity email mismatch", 400);
        }

        if (intent === "delete") {
          const record = await deleteManagedIdentity(identityId);
          if (!record) {
            return text("Unknown identityId", 400);
          }

          const accept = request.headers.get("accept") || "";
          if (accept.includes("application/json")) {
            return json({ ok: true, id: record.id });
          }

          return redirect(
            readRedirectTo(form.get("redirectTo")) || "/admin/identities",
          );
        }

        const record =
          intent === "save-label"
            ? await updateManagedIdentity({
                identityId,
                label: String(form.get("label") || ""),
              })
            : intent === "save-plan"
              ? await updateManagedIdentity({
                  identityId,
                  plan: readManagedIdentityPlan(form.get("plan")),
                })
            : intent === "activate"
              ? await updateManagedIdentity({
                  identityId,
                  status: "ACTIVE",
                })
              : intent === "review"
                ? await updateManagedIdentity({
                    identityId,
                    status: "REVIEW",
                  })
                : intent === "archive"
                  ? await updateManagedIdentity({
                      identityId,
                      status: "ARCHIVED",
                    })
                  : !email
                    ? null
                    : await upsertManagedIdentity({
                        identityId,
                        email,
                        label: String(form.get("label") || ""),
                        plan: readManagedIdentityPlan(form.get("plan")),
                        status: readManagedIdentityStatus(form.get("status")),
                      });

        if (!record) {
          return text("Unable to update managed identity", 400);
        }

        const accept = request.headers.get("accept") || "";
        if (accept.includes("application/json")) {
          return json({ ok: true, id: record.id });
        }

        return redirect(readRedirectTo(form.get("redirectTo")) || "/admin/identities");
      },
    },
  },
});
