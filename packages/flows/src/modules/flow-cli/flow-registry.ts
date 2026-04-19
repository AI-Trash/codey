export type CliFlowCommandId =
  | 'chatgpt-register'
  | 'chatgpt-login'
  | 'chatgpt-login-invite'
  | 'codex-oauth'
  | 'noop'

export type CliFlowOptionType = 'string' | 'number' | 'boolean' | 'stringList'

export interface CliFlowOptionDefinition {
  key: string
  flag: string
  type: CliFlowOptionType
  common?: boolean
}

export interface CliFlowDefinition {
  id: CliFlowCommandId
  options: readonly string[]
}

export type CliFlowTaskOptionValue = string | number | boolean | string[]

export interface CliFlowTaskPayload {
  kind: 'flow_task'
  flowId: CliFlowCommandId
  options: Record<string, CliFlowTaskOptionValue>
}

export const cliFlowCommonOptionDefinitions = [
  {
    key: 'chromeDefaultProfile',
    flag: '--chromeDefaultProfile',
    type: 'boolean',
    common: true,
  },
  {
    key: 'headless',
    flag: '--headless',
    type: 'boolean',
    common: true,
  },
  {
    key: 'slowMo',
    flag: '--slowMo',
    type: 'number',
    common: true,
  },
  {
    key: 'har',
    flag: '--har',
    type: 'boolean',
    common: true,
  },
  {
    key: 'record',
    flag: '--record',
    type: 'boolean',
    common: true,
  },
] as const satisfies readonly CliFlowOptionDefinition[]

export const cliFlowOptionDefinitions = [
  ...cliFlowCommonOptionDefinitions,
  {
    key: 'password',
    flag: '--password',
    type: 'string',
  },
  {
    key: 'verificationTimeoutMs',
    flag: '--verificationTimeoutMs',
    type: 'number',
  },
  {
    key: 'pollIntervalMs',
    flag: '--pollIntervalMs',
    type: 'number',
  },
  {
    key: 'identityId',
    flag: '--identityId',
    type: 'string',
  },
  {
    key: 'email',
    flag: '--email',
    type: 'string',
  },
  {
    key: 'inviteEmail',
    flag: '--inviteEmail',
    type: 'stringList',
  },
  {
    key: 'inviteFile',
    flag: '--inviteFile',
    type: 'string',
  },
  {
    key: 'workspaceIndex',
    flag: '--workspaceIndex',
    type: 'number',
  },
  {
    key: 'redirectPort',
    flag: '--redirectPort',
    type: 'number',
  },
  {
    key: 'authorizeUrlOnly',
    flag: '--authorizeUrlOnly',
    type: 'boolean',
  },
  {
    key: 'projectId',
    flag: '--projectId',
    type: 'string',
  },
  {
    key: 'channelName',
    flag: '--channelName',
    type: 'string',
  },
] as const satisfies readonly CliFlowOptionDefinition[]

export const cliFlowDefinitions = [
  {
    id: 'chatgpt-register',
    options: ['password', 'verificationTimeoutMs', 'pollIntervalMs'],
  },
  {
    id: 'chatgpt-login',
    options: ['identityId', 'email'],
  },
  {
    id: 'chatgpt-login-invite',
    options: ['identityId', 'email', 'inviteEmail', 'inviteFile'],
  },
  {
    id: 'codex-oauth',
    options: [
      'identityId',
      'email',
      'verificationTimeoutMs',
      'pollIntervalMs',
      'workspaceIndex',
      'redirectPort',
      'authorizeUrlOnly',
      'projectId',
      'channelName',
    ],
  },
  {
    id: 'noop',
    options: [],
  },
] as const satisfies readonly CliFlowDefinition[]

const cliFlowDefinitionsById = new Map(
  cliFlowDefinitions.map((definition) => [definition.id, definition]),
)

const cliFlowOptionDefinitionsByKey = new Map(
  cliFlowOptionDefinitions.map((definition) => [definition.key, definition]),
)

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

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return normalized.length ? normalized : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  return normalized.length ? normalized : undefined
}

export function listCliFlowCommandIds(): CliFlowCommandId[] {
  return cliFlowDefinitions.map((definition) => definition.id)
}

export function getCliFlowDefinition(
  flowId: string,
): CliFlowDefinition | undefined {
  return cliFlowDefinitionsById.get(flowId as CliFlowCommandId)
}

export function getCliFlowOptionDefinition(
  optionKey: string,
): CliFlowOptionDefinition | undefined {
  return cliFlowOptionDefinitionsByKey.get(optionKey)
}

export function listCliFlowOptionDefinitions(
  flowId: string,
): CliFlowOptionDefinition[] {
  const flowDefinition = getCliFlowDefinition(flowId)
  if (!flowDefinition) {
    return []
  }

  return cliFlowOptionDefinitions.filter(
    (definition) =>
      definition.common || flowDefinition.options.includes(definition.key),
  )
}

export function normalizeCliFlowTaskOptions(
  flowId: string,
  input: Record<string, unknown> | null | undefined,
): Record<string, CliFlowTaskOptionValue> {
  const allowedOptions = listCliFlowOptionDefinitions(flowId)
  const output: Record<string, CliFlowTaskOptionValue> = {}

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return output
  }

  for (const option of allowedOptions) {
    const value = input[option.key]
    let normalized: CliFlowTaskOptionValue | undefined

    if (option.type === 'boolean') {
      normalized = normalizeBoolean(value)
    } else if (option.type === 'number') {
      normalized = normalizeNumber(value)
    } else if (option.type === 'string') {
      normalized = normalizeString(value)
    } else if (option.type === 'stringList') {
      normalized = normalizeStringList(value)
    }

    if (normalized !== undefined) {
      output[option.key] = normalized
    }
  }

  return output
}

export function isCliFlowTaskPayload(
  value: unknown,
): value is CliFlowTaskPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const payload = value as Partial<CliFlowTaskPayload>
  return (
    payload.kind === 'flow_task' &&
    typeof payload.flowId === 'string' &&
    Boolean(getCliFlowDefinition(payload.flowId)) &&
    payload.options != null &&
    typeof payload.options === 'object' &&
    !Array.isArray(payload.options)
  )
}
