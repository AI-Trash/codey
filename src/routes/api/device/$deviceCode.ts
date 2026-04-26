import { createFileRoute } from '@tanstack/react-router'
import {
  consumeApprovedDeviceChallenge,
  pollDeviceChallenge,
} from '../../../lib/server/device-auth'
import { json, text } from '../../../lib/server/http'

export const Route = createFileRoute('/api/device/$deviceCode')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const challenge = await pollDeviceChallenge(params.deviceCode)
        if (!challenge) return text('Device challenge not found', 404)

        return json({
          deviceCode: challenge.deviceCode,
          userCode: challenge.userCode,
          status: challenge.status,
          flowType: challenge.flowType,
          cliName: challenge.cliName,
          approvalMessage: challenge.approvalMessage,
          expiresAt: challenge.expiresAt.toISOString(),
        })
      },
      POST: async ({ params }) => {
        try {
          const result = await consumeApprovedDeviceChallenge(params.deviceCode)
          return json({
            accessToken: result.accessToken,
            user: result.user,
          })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to consume challenge',
            400,
          )
        }
      },
    },
  },
})
