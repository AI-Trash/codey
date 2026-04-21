export type CliFlowCommandId =
  | 'chatgpt-register'
  | 'chatgpt-login'
  | 'chatgpt-login-invite'
  | 'codex-oauth'
  | 'noop'

export type CliFlowOptionType = 'string' | 'number' | 'boolean' | 'stringList'

export type CliFlowDisplayNameKey =
  | 'chatgptRegister'
  | 'chatgptLogin'
  | 'chatgptLoginInvite'
  | 'codexOauth'
  | 'noop'

export type CliFlowDescriptionKey =
  | 'chatgptRegister'
  | 'chatgptLogin'
  | 'chatgptLoginInvite'
  | 'codexOauth'
  | 'noop'

export type CliFlowOptionDisplayNameKey =
  | 'chromeDefaultProfile'
  | 'headless'
  | 'slowMo'
  | 'har'
  | 'record'
  | 'password'
  | 'verificationTimeoutMs'
  | 'pollIntervalMs'
  | 'identityId'
  | 'email'
  | 'inviteEmail'
  | 'inviteFile'
  | 'workspaceIndex'
  | 'redirectPort'
  | 'authorizeUrlOnly'

export type CliFlowOptionDescriptionKey =
  | 'chromeDefaultProfile'
  | 'headless'
  | 'slowMo'
  | 'har'
  | 'record'
  | 'password'
  | 'verificationTimeoutMs'
  | 'pollIntervalMs'
  | 'identityId'
  | 'email'
  | 'inviteEmail'
  | 'inviteFile'
  | 'workspaceIndex'
  | 'redirectPort'
  | 'authorizeUrlOnly'

export interface CliFlowOptionDefinition {
  key: string
  flag: string
  type: CliFlowOptionType
  displayNameKey: CliFlowOptionDisplayNameKey
  descriptionKey?: CliFlowOptionDescriptionKey
  common?: boolean
}

export interface CliFlowDefinition {
  id: CliFlowCommandId
  displayNameKey: CliFlowDisplayNameKey
  descriptionKey?: CliFlowDescriptionKey
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
    displayNameKey: 'chromeDefaultProfile',
    descriptionKey: 'chromeDefaultProfile',
    common: true,
  },
  {
    key: 'headless',
    flag: '--headless',
    type: 'boolean',
    displayNameKey: 'headless',
    descriptionKey: 'headless',
    common: true,
  },
  {
    key: 'slowMo',
    flag: '--slowMo',
    type: 'number',
    displayNameKey: 'slowMo',
    descriptionKey: 'slowMo',
    common: true,
  },
  {
    key: 'har',
    flag: '--har',
    type: 'boolean',
    displayNameKey: 'har',
    descriptionKey: 'har',
    common: true,
  },
  {
    key: 'record',
    flag: '--record',
    type: 'boolean',
    displayNameKey: 'record',
    descriptionKey: 'record',
    common: true,
  },
] as const satisfies readonly CliFlowOptionDefinition[]

export const cliFlowOptionDefinitions = [
  ...cliFlowCommonOptionDefinitions,
  {
    key: 'password',
    flag: '--password',
    type: 'string',
    displayNameKey: 'password',
    descriptionKey: 'password',
  },
  {
    key: 'verificationTimeoutMs',
    flag: '--verificationTimeoutMs',
    type: 'number',
    displayNameKey: 'verificationTimeoutMs',
    descriptionKey: 'verificationTimeoutMs',
  },
  {
    key: 'pollIntervalMs',
    flag: '--pollIntervalMs',
    type: 'number',
    displayNameKey: 'pollIntervalMs',
    descriptionKey: 'pollIntervalMs',
  },
  {
    key: 'identityId',
    flag: '--identityId',
    type: 'string',
    displayNameKey: 'identityId',
    descriptionKey: 'identityId',
  },
  {
    key: 'email',
    flag: '--email',
    type: 'string',
    displayNameKey: 'email',
    descriptionKey: 'email',
  },
  {
    key: 'inviteEmail',
    flag: '--inviteEmail',
    type: 'stringList',
    displayNameKey: 'inviteEmail',
    descriptionKey: 'inviteEmail',
  },
  {
    key: 'inviteFile',
    flag: '--inviteFile',
    type: 'string',
    displayNameKey: 'inviteFile',
    descriptionKey: 'inviteFile',
  },
  {
    key: 'workspaceIndex',
    flag: '--workspaceIndex',
    type: 'number',
    displayNameKey: 'workspaceIndex',
    descriptionKey: 'workspaceIndex',
  },
  {
    key: 'redirectPort',
    flag: '--redirectPort',
    type: 'number',
    displayNameKey: 'redirectPort',
    descriptionKey: 'redirectPort',
  },
  {
    key: 'authorizeUrlOnly',
    flag: '--authorizeUrlOnly',
    type: 'boolean',
    displayNameKey: 'authorizeUrlOnly',
    descriptionKey: 'authorizeUrlOnly',
  },
] as const satisfies readonly CliFlowOptionDefinition[]

export const cliFlowDefinitions = [
  {
    id: 'chatgpt-register',
    displayNameKey: 'chatgptRegister',
    descriptionKey: 'chatgptRegister',
    options: ['password', 'verificationTimeoutMs', 'pollIntervalMs'],
  },
  {
    id: 'chatgpt-login',
    displayNameKey: 'chatgptLogin',
    descriptionKey: 'chatgptLogin',
    options: ['identityId', 'email'],
  },
  {
    id: 'chatgpt-login-invite',
    displayNameKey: 'chatgptLoginInvite',
    descriptionKey: 'chatgptLoginInvite',
    options: ['identityId', 'email', 'inviteEmail', 'inviteFile'],
  },
  {
    id: 'codex-oauth',
    displayNameKey: 'codexOauth',
    descriptionKey: 'codexOauth',
    options: [
      'identityId',
      'email',
      'verificationTimeoutMs',
      'pollIntervalMs',
      'workspaceIndex',
      'redirectPort',
      'authorizeUrlOnly',
    ],
  },
  {
    id: 'noop',
    displayNameKey: 'noop',
    descriptionKey: 'noop',
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
