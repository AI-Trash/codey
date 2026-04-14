import { createFileRoute } from "@tanstack/react-router";
import { text } from "../../../lib/server/http";
import { requireVerificationApiKey } from "../../../lib/server/request";
import { createPollingSseResponse } from "../../../lib/server/sse";
import { findVerificationCode } from "../../../lib/server/verification";

export const Route = createFileRoute("/api/verification/events")({
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

        return createPollingSseResponse({
          intervalMs: 2000,
          timeoutMs: 120000,
          loadEvent: async () => {
            const result = await findVerificationCode({ email, startedAt });
            if (result.status !== "resolved") return null;
            return {
              id: result.receivedAt,
              event: "verification_code",
              done: true,
              data: result,
            };
          },
        });
      },
    },
  },
});
