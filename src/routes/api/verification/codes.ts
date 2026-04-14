import { createFileRoute } from "@tanstack/react-router";
import { json, text } from "../../../lib/server/http";
import { requireVerificationApiKey } from "../../../lib/server/request";
import { findVerificationCode } from "../../../lib/server/verification";

export const Route = createFileRoute("/api/verification/codes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = requireVerificationApiKey(request);
        if (authError) return authError;

        const url = new URL(request.url);
        const email = url.searchParams.get("email");
        const startedAt = url.searchParams.get("startedAt");
        if (!email || !startedAt) {
          return text("email and startedAt are required", 400);
        }

        return json(await findVerificationCode({ email, startedAt }));
      },
    },
  },
});
