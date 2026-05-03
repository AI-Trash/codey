import type { CommonOptions, FlowOptions } from './helpers'
import {
  cliFlowConfigFieldDefinitions,
  getCliFlowConfigFieldDefinitionByFlag,
  normalizeCliFlowConfig,
  type CliFlowCommandId,
  type CliFlowConfigFieldKey,
} from './flow-registry'

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return undefined
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function collectRawCliArgs(argv: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const repeatableKeys = new Set<CliFlowConfigFieldKey>(
    cliFlowConfigFieldDefinitions
      .filter((definition) => definition.type === 'stringList')
      .map((definition) => definition.key),
  )

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]

    if (current === '--config' && next) {
      values.config = next
      index += 1
      continue
    }

    if (current === '--profile' && next) {
      values.profile = next
      index += 1
      continue
    }

    if (!current.startsWith('--')) {
      continue
    }

    const definition = getCliFlowConfigFieldDefinitionByFlag(current)
    if (!definition) {
      continue
    }

    if (next && !next.startsWith('--')) {
      if (repeatableKeys.has(definition.key)) {
        const previous = values[definition.key]
        if (Array.isArray(previous)) {
          previous.push(next)
        } else if (typeof previous === 'string') {
          values[definition.key] = [previous, next]
        } else {
          values[definition.key] = [next]
        }
      } else {
        values[definition.key] = next
      }
      index += 1
      continue
    }

    values[definition.key] = true
  }

  return values
}

export function normalizeCommonCliArgs(
  input: Record<string, unknown> | null | undefined,
): CommonOptions {
  if (!isRecord(input)) {
    return {}
  }

  return {
    config: normalizeString(input.config),
    profile: normalizeString(input.profile),
    chromeDefaultProfile: normalizeBoolean(input.chromeDefaultProfile),
    proxyTag: normalizeString(input.proxyTag),
    headless: normalizeBoolean(input.headless),
    slowMo: normalizeNumber(input.slowMo),
    har: normalizeBoolean(input.har),
    recordPageContent: normalizeBoolean(input.recordPageContent),
  }
}

export function parseCommonCliArgs(argv: string[]): CommonOptions {
  return normalizeCommonCliArgs(collectRawCliArgs(argv))
}

export function normalizeFlowCliArgs(
  input: Record<string, unknown> | null | undefined,
): FlowOptions {
  return {
    ...normalizeCommonCliArgs(input),
    ...normalizeCliFlowConfig('chatgpt-register', input),
    ...normalizeCliFlowConfig('chatgpt-invite', input),
    ...normalizeCliFlowConfig('codex-oauth', input),
  }
}

export function normalizeFlowCliArgsForCommand<
  TFlowId extends CliFlowCommandId,
>(
  flowId: TFlowId,
  input: Record<string, unknown> | null | undefined,
): FlowOptions {
  return {
    ...normalizeCommonCliArgs(input),
    ...normalizeCliFlowConfig(flowId, input),
  }
}

export function parseFlowCliArgs(argv: string[]): FlowOptions {
  return normalizeFlowCliArgs(collectRawCliArgs(argv))
}

export function parseFlowCliArgsForCommand<TFlowId extends CliFlowCommandId>(
  flowId: TFlowId,
  argv: string[],
): FlowOptions {
  return normalizeFlowCliArgsForCommand(flowId, collectRawCliArgs(argv))
}
