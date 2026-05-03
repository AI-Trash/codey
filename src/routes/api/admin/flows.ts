import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../lib/server/auth'
import { json, text } from '../../../lib/server/http'
import {
  type ClearAdminFlowRunsMode,
  clearAdminFlowRunsForActor,
  getAdminFlowRunSnapshotForActor,
  getAdminFlowTaskDetailForActor,
} from '../../../lib/server/flow-runs'
import {
  requestFlowTaskStop,
  requeueFlowTask,
} from '../../../lib/server/flow-tasks'

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

function readAction(request: Request): 'stop' | 'retry' | undefined {
  const action = readOptionalQueryParam(request, 'action')

  if (action === 'stop' || action === 'retry') {
    return action
  }

  return undefined
}

async function readOptionalJsonBody(request: Request) {
  try {
    const parsed = await request.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function readOptionalBodyString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = body[key]
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || null
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
        if (readOptionalQueryParam(request, 'mode') !== undefined && !mode) {
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
      POST: async ({ request }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          admin = await requireAdminPermission(request, 'CLI_OPERATIONS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Admin access required',
            401,
          )
        }

        const action = readAction(request)
        if (!action) {
          return text('action must be "stop" or "retry"', 400)
        }

        const taskId = readOptionalQueryParam(request, 'taskId')
        if (!taskId) {
          return text('taskId is required', 400)
        }

        const actor = {
          userId: admin.user.id,
          githubLogin: admin.user.githubLogin,
          email: admin.user.email,
        }
        const visibleTask = await getAdminFlowTaskDetailForActor({
          actor,
          taskId,
        })
        if (!visibleTask) {
          return text('Flow task not found', 404)
        }

        const body = await readOptionalJsonBody(request)
        const reason = readOptionalBodyString(body, 'reason')
        if ('reason' in body && reason === undefined) {
          return text('reason must be a string or null', 400)
        }

        const task =
          action === 'stop'
            ? await requestFlowTaskStop({ taskId, reason })
            : await requeueFlowTask({ taskId, reason })

        if (!task) {
          return text('Unable to update flow task', 409)
        }

        return json(
          await getAdminFlowRunSnapshotForActor({
            actor,
            taskId,
          }),
        )
      },
    },
  },
})
