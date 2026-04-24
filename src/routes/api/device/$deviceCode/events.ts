import { createFileRoute } from "@tanstack/react-router";
import { pollDeviceChallenge } from "../../../../lib/server/device-auth";
import { text } from "../../../../lib/server/http";
import { createPollingSseResponse } from "../../../../lib/server/sse";

export const Route = createFileRoute("/api/device/$deviceCode/events")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const initial = await pollDeviceChallenge(params.deviceCode);
        if (!initial) return text("Device challenge not found", 404);

        return createPollingSseResponse({
          intervalMs: 2000,
          timeoutMs: 120000,
          loadEvent: async () => {
            const challenge = await pollDeviceChallenge(params.deviceCode);
            if (!challenge) {
              return {
                event: "missing",
                done: true,
                data: { status: "missing" },
              };
            }

            if (challenge.status === "PENDING") {
              return null;
            }

            return {
              id:
                challenge.lastPolledAt?.toISOString() ||
                challenge.createdAt.toISOString(),
              event: "device_status",
              done: true,
              data: {
                status: challenge.status,
                userCode: challenge.userCode,
                approvalMessage: challenge.approvalMessage,
              },
            };
          },
        });
      },
    },
  },
});
