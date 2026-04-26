import { createFileRoute } from '@tanstack/react-router'
import { json } from '../../../lib/server/http'
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

        const reservation = await reserveVerificationEmailTarget()
        return json(reservation, 201)
      },
    },
  },
})
