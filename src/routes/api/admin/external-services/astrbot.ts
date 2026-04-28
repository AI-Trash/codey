import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../../lib/server/auth'
import {
  getAstrBotServiceSummary,
  upsertAstrBotServiceConfig,
} from '../../../../lib/server/external-service-configs'
import { json, text } from '../../../../lib/server/http'
import { readJsonBody } from '../../../../lib/server/request'

interface UpdateAstrBotServiceBody {
  enabled?: boolean
  baseUrl?: string | null
  authMode?: 'api_key' | 'bearer_token'
  apiKey?: string | null
  bearerToken?: string | null
  umo?: string | null
  messagePath?: string | null
  timeoutMs?: number | null
  messageTemplate?: string | null
}

function readOptionalInteger(value: unknown): number | null | undefined {
  if (value === null) {
    return null
  }

  if (value === undefined || value === '') {
    return undefined
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed)) {
      return parsed
    }
  }

  throw new Error('Expected a whole number.')
}

export const Route = createFileRoute('/api/admin/external-services/astrbot')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'OAUTH_CLIENTS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        return json({
          service: await getAstrBotServiceSummary(),
        })
      },
      PATCH: async ({ request }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          admin = await requireAdminPermission(request, 'OAUTH_CLIENTS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body = await readJsonBody<UpdateAstrBotServiceBody>(request)

        try {
          const service = await upsertAstrBotServiceConfig({
            enabled:
              typeof body.enabled === 'boolean' ? body.enabled : undefined,
            baseUrl:
              typeof body.baseUrl === 'string' || body.baseUrl === null
                ? body.baseUrl
                : undefined,
            authMode:
              body.authMode === 'api_key'
                ? 'api_key'
                : body.authMode === 'bearer_token'
                  ? 'bearer_token'
                  : undefined,
            apiKey:
              typeof body.apiKey === 'string' || body.apiKey === null
                ? body.apiKey
                : undefined,
            bearerToken:
              typeof body.bearerToken === 'string' || body.bearerToken === null
                ? body.bearerToken
                : undefined,
            umo:
              typeof body.umo === 'string' || body.umo === null
                ? body.umo
                : undefined,
            messagePath:
              typeof body.messagePath === 'string' || body.messagePath === null
                ? body.messagePath
                : undefined,
            timeoutMs: readOptionalInteger(body.timeoutMs),
            messageTemplate:
              typeof body.messageTemplate === 'string' ||
              body.messageTemplate === null
                ? body.messageTemplate
                : undefined,
            updatedByUserId: admin.user.id,
          })

          return json({ service })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to save AstrBot configuration',
            400,
          )
        }
      },
    },
  },
})
