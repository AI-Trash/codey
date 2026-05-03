import { createFileRoute } from '@tanstack/react-router'

import { normalizeCliFlowCommandId } from '../../../../packages/cli/src/modules/flow-cli/flow-registry'
import { requireAdminPermission } from '../../../lib/server/auth'
import {
  listFlowTaskDefaultConfigs,
  saveFlowTaskDefaultConfig,
} from '../../../lib/server/flow-defaults'
import { json, text } from '../../../lib/server/http'

function readOptionalQueryParam(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key)
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function readConfig(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

export const Route = createFileRoute('/api/admin/flow-defaults')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'CLI_OPERATIONS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Admin access required',
            401,
          )
        }

        return json(await listFlowTaskDefaultConfigs())
      },
      PUT: async ({ request }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          admin = await requireAdminPermission(request, 'CLI_OPERATIONS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Admin access required',
            401,
          )
        }

        let body: Record<string, unknown> | null = null
        try {
          const parsed = await request.json()
          body =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : null
        } catch {
          return text('Invalid JSON body', 400)
        }

        const flowId =
          normalizeCliFlowCommandId(
            typeof body?.flowId === 'string' ? body.flowId : '',
          ) ||
          normalizeCliFlowCommandId(
            readOptionalQueryParam(request, 'flowId') || '',
          )
        if (!flowId) {
          return text('flowId is required', 400)
        }

        const config = readConfig(body?.config)
        if (!config) {
          return text('config must be an object', 400)
        }

        return json({
          ok: true,
          defaultConfig: await saveFlowTaskDefaultConfig({
            flowId,
            config,
            updatedByUserId: admin.user.id,
          }),
        })
      },
    },
  },
})
