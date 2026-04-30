import { createFileRoute } from '@tanstack/react-router'
import { json, text } from '../../../lib/server/http'
import { VERIFICATION_READ_SCOPE } from '../../../lib/server/oauth-scopes'
import { requireVerificationAccess } from '../../../lib/server/request'
import {
  findVerificationCode,
  findWhatsAppVerificationCode,
} from '../../../lib/server/verification'

export const Route = createFileRoute('/api/verification/codes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await requireVerificationAccess(request, [
          VERIFICATION_READ_SCOPE,
        ])
        if (authError) return authError

        const url = new URL(request.url)
        const email = url.searchParams.get('email')
        const reservationId = url.searchParams.get('reservationId')
        const startedAt = url.searchParams.get('startedAt')
        const source = url.searchParams.get('source')?.toLowerCase()
        if (source === 'whatsapp' || source === 'whatsapp_notification') {
          if (!startedAt) {
            return text('startedAt is required', 400)
          }

          return json(
            await findWhatsAppVerificationCode({
              startedAt,
              email,
              reservationId,
            }),
          )
        }

        if (!email || !startedAt) {
          return text('email and startedAt are required', 400)
        }

        return json(await findVerificationCode({ email, startedAt }))
      },
    },
  },
})
