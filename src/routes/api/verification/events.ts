import { createFileRoute } from '@tanstack/react-router'
import { text } from '../../../lib/server/http'
import { VERIFICATION_READ_SCOPE } from '../../../lib/server/oauth-scopes'
import { requireVerificationAccess } from '../../../lib/server/request'
import { createPollingSseResponse } from '../../../lib/server/sse'
import { findVerificationCode } from '../../../lib/server/verification'

export const Route = createFileRoute('/api/verification/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await requireVerificationAccess(request, [
          VERIFICATION_READ_SCOPE,
        ])
        if (authError) return authError

        const url = new URL(request.url)
        const email = url.searchParams.get('email')
        const startedAt = url.searchParams.get('startedAt')
        if (!email || !startedAt) {
          return text('email and startedAt are required', 400)
        }

        return createPollingSseResponse({
          intervalMs: 2000,
          timeoutMs: 120000,
          loadEvent: async () => {
            const result = await findVerificationCode({ email, startedAt })
            const latestEmail = result.emails?.[0]
            if (result.status !== 'resolved' && !latestEmail) return null
            return {
              id: result.receivedAt || latestEmail?.receivedAt || startedAt,
              event: 'verification_code',
              done: true,
              data: result,
            }
          },
        })
      },
    },
  },
})
