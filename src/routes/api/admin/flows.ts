import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../lib/server/auth'
import { json, text } from '../../../lib/server/http'
import {
  type ClearAdminFlowRunsMode,
  clearAdminFlowRunsForActor,
  getAdminFlowRunSnapshotForActor,
} from '../../../lib/server/flow-runs'

function readOptionalQueryParam(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key)
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function readClearMode(request: Request): ClearAdminFlowRunsMode | undefined {
  const mode = readOptionalQueryParam(request, 'mode')

  if (mode === 'completed' || mode === 'all') {
    return mode
  }

  return undefined
}

export const Route = createFileRoute('/api/admin/flows')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          admin = await requireAdminPermission(request, 'CLI_OPERATIONS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Admin access required',
            401,
          )
        }

        return json(
          await getAdminFlowRunSnapshotForActor({
            actor: {
              userId: admin.user.id,
              githubLogin: admin.user.githubLogin,
              email: admin.user.email,
            },
            taskId: readOptionalQueryParam(request, 'taskId'),
          }),
        )
      },
      DELETE: async ({ request }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          admin = await requireAdminPermission(request, 'CLI_OPERATIONS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Admin access required',
            401,
          )
        }

        const mode = readClearMode(request)
        if (
          readOptionalQueryParam(request, 'mode') !== undefined &&
          !mode
        ) {
          return text('mode must be "completed" or "all"', 400)
        }

        return json(
          await clearAdminFlowRunsForActor({
            actor: {
              userId: admin.user.id,
              githubLogin: admin.user.githubLogin,
              email: admin.user.email,
            },
            mode,
          }),
        )
      },
    },
  },
})
