import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'

import {
  cliFlowDefinitions,
  normalizeCliFlowCommandId,
  normalizeCliFlowConfig,
  type CliFlowCommandId,
  type CliFlowConfigById,
} from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import { getDb } from './db/client'
import { flowTaskDefaultConfigs } from './db/schema'

export interface FlowTaskDefaultConfigSummary<
  TFlowId extends CliFlowCommandId = CliFlowCommandId,
> {
  flowType: TFlowId
  config: CliFlowConfigById[TFlowId]
  updatedByUserId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface FlowTaskDefaultConfigsSnapshot {
  snapshotAt: string
  defaults: FlowTaskDefaultConfigSummary[]
}

function mapDefaultConfigRow(row: {
  flowType: string
  config: Record<string, unknown>
  updatedByUserId: string | null
  createdAt: Date
  updatedAt: Date
}): FlowTaskDefaultConfigSummary | null {
  const flowId = normalizeCliFlowCommandId(row.flowType)
  if (!flowId) {
    return null
  }

  return {
    flowType: flowId,
    config: normalizeCliFlowConfig(flowId, row.config),
    updatedByUserId: row.updatedByUserId || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listFlowTaskDefaultConfigs(): Promise<FlowTaskDefaultConfigsSnapshot> {
  const rows = await getDb().query.flowTaskDefaultConfigs.findMany()
  const byFlowId = new Map(
    rows
      .map((row) => mapDefaultConfigRow(row))
      .filter((row): row is FlowTaskDefaultConfigSummary => Boolean(row))
      .map((row) => [row.flowType, row]),
  )

  return {
    snapshotAt: new Date().toISOString(),
    defaults: cliFlowDefinitions.map((definition) => {
      const existing = byFlowId.get(definition.id)
      return (
        existing || {
          flowType: definition.id,
          config: normalizeCliFlowConfig(definition.id, {}),
          updatedByUserId: null,
          createdAt: null,
          updatedAt: null,
        }
      )
    }),
  }
}

export async function getFlowTaskDefaultConfig<
  TFlowId extends CliFlowCommandId,
>(flowId: TFlowId): Promise<CliFlowConfigById[TFlowId]> {
  const normalizedFlowId = normalizeCliFlowCommandId(flowId)
  if (!normalizedFlowId) {
    return normalizeCliFlowConfig(flowId, {})
  }

  const row = await getDb().query.flowTaskDefaultConfigs.findFirst({
    where: eq(flowTaskDefaultConfigs.flowType, normalizedFlowId),
  })

  return normalizeCliFlowConfig(flowId, row?.config || {})
}

export async function saveFlowTaskDefaultConfig<
  TFlowId extends CliFlowCommandId,
>(input: {
  flowId: TFlowId
  config: Record<string, unknown> | null | undefined
  updatedByUserId?: string | null
}): Promise<FlowTaskDefaultConfigSummary<TFlowId>> {
  const normalizedFlowId = normalizeCliFlowCommandId(input.flowId)
  if (!normalizedFlowId) {
    throw new Error('Unsupported flow type.')
  }

  const now = new Date()
  const normalizedConfig = normalizeCliFlowConfig(
    normalizedFlowId,
    input.config,
  )
  const [row] = await getDb()
    .insert(flowTaskDefaultConfigs)
    .values({
      flowType: normalizedFlowId,
      config: normalizedConfig,
      updatedByUserId: input.updatedByUserId || null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: flowTaskDefaultConfigs.flowType,
      set: {
        config: normalizedConfig,
        updatedByUserId: input.updatedByUserId || null,
        updatedAt: now,
      },
    })
    .returning()

  if (!row) {
    throw new Error('Unable to save flow default options.')
  }

  const mapped = mapDefaultConfigRow(row)
  if (!mapped) {
    throw new Error('Unable to read saved flow default options.')
  }

  return mapped as FlowTaskDefaultConfigSummary<TFlowId>
}
