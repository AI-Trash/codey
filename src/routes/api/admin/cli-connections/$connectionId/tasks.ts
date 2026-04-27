import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../../../lib/server/auth'
import { json, text } from '../../../../../lib/server/http'
import {
  dispatchCliFlowTasks,
  MAX_CLI_FLOW_TASK_BATCH_SIZE,
} from '../../../../../lib/server/cli-tasks'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readRequestedTaskCount(body: Record<string, unknown> | null) {
  const configCount = Array.isArray(body?.configs)
    ? body.configs.filter(isRecord).length
    : 0
  const rawExplicitValue =
    typeof body?.repeatCount === 'number' ||
    typeof body?.repeatCount === 'string'
      ? body.repeatCount
      : typeof body?.count === 'number' || typeof body?.count === 'string'
        ? body.count
        : undefined

  if (configCount > 0) {
    if (configCount > MAX_CLI_FLOW_TASK_BATCH_SIZE) {
      throw new Error(
        `repeatCount cannot exceed ${MAX_CLI_FLOW_TASK_BATCH_SIZE}.`,
      )
    }

    if (rawExplicitValue != null) {
      const explicitCount =
        typeof rawExplicitValue === 'number'
          ? rawExplicitValue
          : Number.parseInt(rawExplicitValue, 10)

      if (!Number.isInteger(explicitCount) || explicitCount < 1) {
        throw new Error('repeatCount must be a whole number greater than 0.')
      }

      if (explicitCount !== configCount) {
        throw new Error('repeatCount must match configs length.')
      }
    }

    return configCount
  }

  const rawValue = rawExplicitValue != null ? rawExplicitValue : 1

  const parsed =
    typeof rawValue === 'number' ? rawValue : Number.parseInt(rawValue, 10)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('repeatCount must be a whole number greater than 0.')
  }

  if (parsed > MAX_CLI_FLOW_TASK_BATCH_SIZE) {
    throw new Error(
      `repeatCount cannot exceed ${MAX_CLI_FLOW_TASK_BATCH_SIZE}.`,
    )
  }

  return parsed
}

export const Route = createFileRoute(
  '/api/admin/cli-connections/$connectionId/tasks',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
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
          typeof body?.flowId === 'string' ? body.flowId.trim() : ''
        if (!flowId) {
          return text('flowId is required', 400)
        }

        try {
          const repeatCount = readRequestedTaskCount(body)
          const result = await dispatchCliFlowTasks({
            connectionId: params.connectionId,
            flowId,
            count: repeatCount,
            maxTaskCount: MAX_CLI_FLOW_TASK_BATCH_SIZE,
            actor: {
              userId: admin.user.id,
              githubLogin: admin.user.githubLogin,
              email: admin.user.email,
            },
            config: isRecord(body?.config)
              ? (body.config as Record<string, unknown>)
              : body?.options && isRecord(body.options)
                ? (body.options as Record<string, unknown>)
                : null,
            configs: Array.isArray(body?.configs)
              ? body.configs.filter(isRecord)
              : null,
          })

          return json(
            {
              ok: true,
              taskId: result.tasks[0]?.id || null,
              taskIds: result.tasks.map((task) => task.id),
              queuedCount: result.tasks.length,
              assignedCliCount: result.assignedCliCount,
              batchId: result.batchId || null,
              connectionId: result.connection.id,
              flowId,
              config: result.config,
              configs: result.configs || null,
              externalServices: result.externalServices || null,
            },
            201,
          )
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to dispatch flow task',
            400,
          )
        }
      },
    },
  },
})
