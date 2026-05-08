import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../../lib/server/auth'
import { json, text } from '../../../../lib/server/http'
import { readJsonBody } from '../../../../lib/server/request'
import { updateVerificationDomain } from '../../../../lib/server/verification-domains'

interface UpdateVerificationDomainBody {
  domain?: string
  mailboxType?: 'cloudflare' | 'outlook'
  mailboxPrefix?: string | null
  description?: string | null
  registrationEnabled?: boolean
  isDefault?: boolean
}

export const Route = createFileRoute(
  '/api/admin/verification-domains/$domainId',
)({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          await requireAdminPermission(request, 'VERIFICATION_DOMAINS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body = await readJsonBody<UpdateVerificationDomainBody>(request)

        try {
          const domain = await updateVerificationDomain(params.domainId, {
            domain: typeof body.domain === 'string' ? body.domain : undefined,
            mailboxType:
              body.mailboxType === 'cloudflare' ||
              body.mailboxType === 'outlook'
                ? body.mailboxType
                : undefined,
            mailboxPrefix:
              typeof body.mailboxPrefix === 'string' ||
              body.mailboxPrefix === null
                ? body.mailboxPrefix
                : undefined,
            description:
              typeof body.description === 'string' || body.description === null
                ? body.description
                : undefined,
            registrationEnabled:
              typeof body.registrationEnabled === 'boolean'
                ? body.registrationEnabled
                : undefined,
            isDefault:
              typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
          })

          return json({ domain })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to update verification mailbox',
            400,
          )
        }
      },
    },
  },
})
