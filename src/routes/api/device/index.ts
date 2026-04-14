import { createFileRoute } from "@tanstack/react-router";
import { createDeviceChallenge } from "../../../lib/server/device-auth";
import { json } from "../../../lib/server/http";
import { readJsonBody } from "../../../lib/server/request";

interface DeviceChallengeRequest {
  scope?: string;
  flowType?: string;
  cliName?: string;
  requestedBy?: string;
}

export const Route = createFileRoute("/api/device/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonBody<DeviceChallengeRequest>(request);
        const challenge = await createDeviceChallenge(body);
        return json(
          {
            deviceCode: challenge.deviceCode,
            userCode: challenge.userCode,
            status: challenge.status,
            expiresAt: challenge.expiresAt.toISOString(),
            verificationUri: "/device",
            verificationUriComplete: `/device?userCode=${encodeURIComponent(challenge.userCode)}`,
          },
          201,
        );
      },
    },
  },
});
