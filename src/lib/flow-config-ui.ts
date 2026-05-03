import type {
  CliFlowCommandId,
  CliFlowConfigById,
  CliFlowConfigFieldDefinition,
} from '../../packages/cli/src/modules/flow-cli/flow-registry'

export type DraftOptionState = Record<string, string>
export type BuildFlowConfigFromDraftOptions = {
  transformRawValue?: (input: {
    definition: CliFlowConfigFieldDefinition
    rawValue: string
  }) => string | undefined
}

export function stringifyFlowConfigValue(
  value: unknown,
  definition: CliFlowConfigFieldDefinition,
): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (definition.type === 'boolean') {
    return typeof value === 'boolean' ? String(value) : ''
  }

  if (definition.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : ''
  }

  if (definition.type === 'stringList') {
    return Array.isArray(value)
      ? value.filter((entry) => typeof entry === 'string').join('\n')
      : typeof value === 'string'
        ? value
        : ''
  }

  return typeof value === 'string' ? value : ''
}

export function createDraftValuesFromFlowConfig(
  _flowId: CliFlowCommandId,
  config: Record<string, unknown> | null | undefined,
  definitions: CliFlowConfigFieldDefinition[],
): DraftOptionState {
  if (!config) {
    return {}
  }

  const draft: DraftOptionState = {}
  for (const definition of definitions) {
    const value = stringifyFlowConfigValue(config[definition.key], definition)
    if (value) {
      draft[definition.key] = value
    }
  }

  return draft
}

export function buildFlowConfigFromDraft<TFlowId extends CliFlowCommandId>(
  _flowId: TFlowId,
  definitions: CliFlowConfigFieldDefinition[],
  draftValues: DraftOptionState,
  helpers: {
    getFieldLabel: (definition: CliFlowConfigFieldDefinition) => string
    getInvalidNumberMessage: (fieldLabel: string) => string
  },
  options: BuildFlowConfigFromDraftOptions = {},
): CliFlowConfigById[TFlowId] {
  const config: Record<string, unknown> = {}

  for (const definition of definitions) {
    const rawDraftValue = draftValues[definition.key]
    const rawValue =
      typeof rawDraftValue === 'string'
        ? (options.transformRawValue?.({
            definition,
            rawValue: rawDraftValue,
          }) ?? rawDraftValue)
        : rawDraftValue
    if (!rawValue?.trim()) {
      continue
    }

    if (definition.type === 'boolean') {
      if (rawValue === 'true' || rawValue === 'false') {
        config[definition.key] = rawValue === 'true'
      }
      continue
    }

    if (definition.type === 'number') {
      const parsed = Number(rawValue)
      if (!Number.isFinite(parsed)) {
        throw new Error(
          helpers.getInvalidNumberMessage(helpers.getFieldLabel(definition)),
        )
      }
      config[definition.key] = parsed
      continue
    }

    if (definition.type === 'select') {
      if (definition.options?.some((option) => option.value === rawValue)) {
        config[definition.key] = rawValue
      }
      continue
    }

    if (definition.type === 'stringList') {
      const parsed = rawValue
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
      if (parsed.length) {
        config[definition.key] = parsed
      }
      continue
    }

    config[definition.key] = rawValue.trim()
  }

  return config as CliFlowConfigById[TFlowId]
}
