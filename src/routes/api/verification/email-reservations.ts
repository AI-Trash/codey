import { createFileRoute } from '@tanstack/react-router'
import { json, text } from '../../../lib/server/http'
import { VERIFICATION_RESERVE_SCOPE } from '../../../lib/server/oauth-scopes'
import { authorizeVerificationAccess } from '../../../lib/server/request'
import { reserveVerificationEmailTarget } from '../../../lib/server/verification'

export const Route = createFileRoute('/api/verification/email-reservations')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = await authorizeVerificationAccess(request, [
          VERIFICATION_RESERVE_SCOPE,
        ])
        if (authResult instanceof Response) return authResult

        try {
          const reservation = await reserveVerificationEmailTarget()
          return json(reservation, 201)
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to reserve verification email target',
            500,
          )
        }
      },
    },
  },
})
