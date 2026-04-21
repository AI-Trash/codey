export type CliFlowCommandId =
  | 'chatgpt-register'
  | 'chatgpt-login'
  | 'chatgpt-login-invite'
  | 'codex-oauth'
  | 'noop'

export type CliFlowConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'stringList'

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

export type CliFlowConfigFieldDisplayNameKey =
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

export type CliFlowConfigFieldDescriptionKey =
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

export type CliFlowConfigFieldKey =
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

export interface CliFlowConfigFieldDefinition {
  key: CliFlowConfigFieldKey
  cliFlag: string
  type: CliFlowConfigFieldType
  displayNameKey: CliFlowConfigFieldDisplayNameKey
  descriptionKey?: CliFlowConfigFieldDescriptionKey
  common?: boolean
}

export interface CliFlowDefinition {
  id: CliFlowCommandId
  displayNameKey: CliFlowDisplayNameKey
  descriptionKey?: CliFlowDescriptionKey
  configKeys: readonly CliFlowConfigFieldKey[]
}

/**
 * Shared browser startup flags that every flow can understand.
 */
export interface CommonFlowConfig {
  /**
   * Clone the local Chrome `Default` profile into the automation session
   * before launch.
   */
  chromeDefaultProfile?: boolean

  /**
   * Run the browser without opening a visible window.
   */
  headless?: boolean

  /**
   * Delay each browser action by this many milliseconds.
   */
  slowMo?: number

  /**
   * Capture a browser HAR for this run.
   */
  har?: boolean

  /**
   * Keep the browser open after the flow finishes.
   */
  record?: boolean
}

/**
 * Configuration for creating a brand-new ChatGPT account.
 */
export interface ChatGPTRegisterFlowConfig extends CommonFlowConfig {
  /**
   * Override the generated password for the new identity.
   */
  password?: string

  /**
   * Maximum time to wait for the verification email, in milliseconds.
   */
  verificationTimeoutMs?: number

  /**
   * Poll interval for verification email updates, in milliseconds.
   */
  pollIntervalMs?: number
}

/**
 * Configuration for signing in with a shared ChatGPT identity.
 */
export interface ChatGPTLoginFlowConfig extends CommonFlowConfig {
  /**
   * Resolve a shared ChatGPT identity by Codey identity record id.
   */
  identityId?: string

  /**
   * Resolve a shared ChatGPT identity by email address.
   */
  email?: string
}

/**
 * Configuration for signing in and inviting ChatGPT workspace members.
 */
export interface ChatGPTLoginInviteFlowConfig
  extends ChatGPTLoginFlowConfig {
  /**
   * Invite one or more email addresses after login succeeds.
   */
  inviteEmail?: string[]

  /**
   * Read invite email addresses from a CSV or JSON file.
   */
  inviteFile?: string
}

/**
 * Configuration for running Codex OAuth and persisting the shared session.
 */
export interface CodexOAuthFlowConfig extends CommonFlowConfig {
  /**
   * Resolve a shared ChatGPT identity by Codey identity record id when the
   * OpenAI login flow needs credentials.
   */
  identityId?: string

  /**
   * Resolve a shared ChatGPT identity by email address when the OpenAI login
   * flow needs credentials.
   */
  email?: string

  /**
   * Maximum time to wait for email verification or browser handoff, in
   * milliseconds.
   */
  verificationTimeoutMs?: number

  /**
   * Poll interval for verification email updates, in milliseconds.
   */
  pollIntervalMs?: number

  /**
   * 1-based workspace index to select in the Codex workspace picker.
   */
  workspaceIndex?: number

  /**
   * Override the local redirect port used for the OAuth callback.
   */
  redirectPort?: number

  /**
   * Print the generated OAuth authorize URL and exit before continuing the
   * browser flow.
   */
  authorizeUrlOnly?: boolean
}

/**
 * Configuration for opening a disposable browser window without automation.
 */
export interface NoopFlowConfig extends CommonFlowConfig {}

export interface CliFlowConfigById {
  'chatgpt-register': ChatGPTRegisterFlowConfig
  'chatgpt-login': ChatGPTLoginFlowConfig
  'chatgpt-login-invite': ChatGPTLoginInviteFlowConfig
  'codex-oauth': CodexOAuthFlowConfig
  noop: NoopFlowConfig
}

export type CliFlowConfig<T extends CliFlowCommandId = CliFlowCommandId> =
  CliFlowConfigById[T]

export type AnyCliFlowConfig = CliFlowConfigById[CliFlowCommandId]

export interface CliFlowTaskBatchMetadata {
  batchId?: string
  sequence?: number
  total?: number
  parallelism?: number
}

export const DEFAULT_CLI_FLOW_TASK_COUNT = 1
export const DEFAULT_CLI_FLOW_TASK_PARALLELISM = 1
export const MAX_CLI_FLOW_TASK_BATCH_SIZE = 20
export const MAX_CLI_FLOW_TASK_PARALLELISM = 4

export type CliFlowTaskRequestById = {
  [FlowId in CliFlowCommandId]: {
    flowId: FlowId
    config: CliFlowConfigById[FlowId]
  }
}

export type CliFlowTaskRequest =
  CliFlowTaskRequestById[CliFlowCommandId]

export type CliFlowTaskPayloadById = {
  [FlowId in CliFlowCommandId]: {
    kind: 'flow_task'
    flowId: FlowId
    config: CliFlowConfigById[FlowId]
    batch?: CliFlowTaskBatchMetadata
  }
}

export type CliFlowTaskPayload =
  CliFlowTaskPayloadById[CliFlowCommandId]

export const cliFlowCommonConfigFieldDefinitions = [
  {
    key: 'chromeDefaultProfile',
    cliFlag: '--chromeDefaultProfile',
    type: 'boolean',
    displayNameKey: 'chromeDefaultProfile',
    descriptionKey: 'chromeDefaultProfile',
    common: true,
  },
  {
    key: 'headless',
    cliFlag: '--headless',
    type: 'boolean',
    displayNameKey: 'headless',
    descriptionKey: 'headless',
    common: true,
  },
  {
    key: 'slowMo',
    cliFlag: '--slowMo',
    type: 'number',
    displayNameKey: 'slowMo',
    descriptionKey: 'slowMo',
    common: true,
  },
  {
    key: 'har',
    cliFlag: '--har',
    type: 'boolean',
    displayNameKey: 'har',
    descriptionKey: 'har',
    common: true,
  },
  {
    key: 'record',
    cliFlag: '--record',
    type: 'boolean',
    displayNameKey: 'record',
    descriptionKey: 'record',
    common: true,
  },
] as const satisfies readonly CliFlowConfigFieldDefinition[]

export const cliFlowConfigFieldDefinitions = [
  ...cliFlowCommonConfigFieldDefinitions,
  {
    key: 'password',
    cliFlag: '--password',
    type: 'string',
    displayNameKey: 'password',
    descriptionKey: 'password',
  },
  {
    key: 'verificationTimeoutMs',
    cliFlag: '--verificationTimeoutMs',
    type: 'number',
    displayNameKey: 'verificationTimeoutMs',
    descriptionKey: 'verificationTimeoutMs',
  },
  {
    key: 'pollIntervalMs',
    cliFlag: '--pollIntervalMs',
    type: 'number',
    displayNameKey: 'pollIntervalMs',
    descriptionKey: 'pollIntervalMs',
  },
  {
    key: 'identityId',
    cliFlag: '--identityId',
    type: 'string',
    displayNameKey: 'identityId',
    descriptionKey: 'identityId',
  },
  {
    key: 'email',
    cliFlag: '--email',
    type: 'string',
    displayNameKey: 'email',
    descriptionKey: 'email',
  },
  {
    key: 'inviteEmail',
    cliFlag: '--inviteEmail',
    type: 'stringList',
    displayNameKey: 'inviteEmail',
    descriptionKey: 'inviteEmail',
  },
  {
    key: 'inviteFile',
    cliFlag: '--inviteFile',
    type: 'string',
    displayNameKey: 'inviteFile',
    descriptionKey: 'inviteFile',
  },
  {
    key: 'workspaceIndex',
    cliFlag: '--workspaceIndex',
    type: 'number',
    displayNameKey: 'workspaceIndex',
    descriptionKey: 'workspaceIndex',
  },
  {
    key: 'redirectPort',
    cliFlag: '--redirectPort',
    type: 'number',
    displayNameKey: 'redirectPort',
    descriptionKey: 'redirectPort',
  },
  {
    key: 'authorizeUrlOnly',
    cliFlag: '--authorizeUrlOnly',
    type: 'boolean',
    displayNameKey: 'authorizeUrlOnly',
    descriptionKey: 'authorizeUrlOnly',
  },
] as const satisfies readonly CliFlowConfigFieldDefinition[]

export const cliFlowDefinitions = [
  {
    id: 'chatgpt-register',
    displayNameKey: 'chatgptRegister',
    descriptionKey: 'chatgptRegister',
    configKeys: ['password', 'verificationTimeoutMs', 'pollIntervalMs'],
  },
  {
    id: 'chatgpt-login',
    displayNameKey: 'chatgptLogin',
    descriptionKey: 'chatgptLogin',
    configKeys: ['identityId', 'email'],
  },
  {
    id: 'chatgpt-login-invite',
    displayNameKey: 'chatgptLoginInvite',
    descriptionKey: 'chatgptLoginInvite',
    configKeys: ['identityId', 'email', 'inviteEmail', 'inviteFile'],
  },
  {
    id: 'codex-oauth',
    displayNameKey: 'codexOauth',
    descriptionKey: 'codexOauth',
    configKeys: [
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
    configKeys: [],
  },
] as const satisfies readonly CliFlowDefinition[]

const cliFlowDefinitionsById = new Map(
  cliFlowDefinitions.map((definition) => [definition.id, definition]),
)

const cliFlowConfigFieldDefinitionsByKey = new Map(
  cliFlowConfigFieldDefinitions.map((definition) => [definition.key, definition]),
)

const cliFlowConfigFieldDefinitionsByFlag = new Map(
  cliFlowConfigFieldDefinitions.map((definition) => [definition.cliFlag, definition]),
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

function normalizeCliFlowConfigFieldValue(
  definition: CliFlowConfigFieldDefinition,
  value: unknown,
): string | number | boolean | string[] | undefined {
  if (definition.type === 'boolean') {
    return normalizeBoolean(value)
  }

  if (definition.type === 'number') {
    return normalizeNumber(value)
  }

  if (definition.type === 'stringList') {
    return normalizeStringList(value)
  }

  return normalizeString(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePositiveInteger(
  value: unknown,
  max: number,
): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1) {
      return undefined
    }
    return Math.min(value, max)
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined
  }

  return Math.min(parsed, max)
}

function normalizeBatchId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

export function normalizeCliFlowTaskCount(value: unknown): number {
  return (
    normalizePositiveInteger(value, MAX_CLI_FLOW_TASK_BATCH_SIZE) ||
    DEFAULT_CLI_FLOW_TASK_COUNT
  )
}

export function normalizeCliFlowTaskParallelism(
  value: unknown,
  input: {
    count?: number
  } = {},
): number {
  const count = Math.max(
    DEFAULT_CLI_FLOW_TASK_COUNT,
    Math.min(
      input.count || DEFAULT_CLI_FLOW_TASK_COUNT,
      MAX_CLI_FLOW_TASK_BATCH_SIZE,
    ),
  )
  const normalized =
    normalizePositiveInteger(value, MAX_CLI_FLOW_TASK_PARALLELISM) ||
    DEFAULT_CLI_FLOW_TASK_PARALLELISM

  return Math.min(normalized, count)
}

export function normalizeCliFlowTaskBatchMetadata(
  value: unknown,
): CliFlowTaskBatchMetadata | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const batchId = normalizeBatchId(value.batchId)
  const total = normalizePositiveInteger(
    value.total,
    MAX_CLI_FLOW_TASK_BATCH_SIZE,
  )
  const sequence = normalizePositiveInteger(
    value.sequence,
    MAX_CLI_FLOW_TASK_BATCH_SIZE,
  )
  const parallelism = normalizeCliFlowTaskParallelism(value.parallelism, {
    count: total,
  })

  if (!batchId && !sequence && !total && parallelism === 1) {
    return undefined
  }

  return {
    ...(batchId ? { batchId } : {}),
    ...(sequence ? { sequence } : {}),
    ...(total ? { total } : {}),
    ...(parallelism > 1 ? { parallelism } : {}),
  }
}

export function listCliFlowCommandIds(): CliFlowCommandId[] {
  return cliFlowDefinitions.map((definition) => definition.id)
}

export function getCliFlowDefinition(
  flowId: string,
): CliFlowDefinition | undefined {
  return cliFlowDefinitionsById.get(flowId as CliFlowCommandId)
}

export function getCliFlowConfigFieldDefinition(
  fieldKey: string,
): CliFlowConfigFieldDefinition | undefined {
  return cliFlowConfigFieldDefinitionsByKey.get(
    fieldKey as CliFlowConfigFieldKey,
  )
}

export function getCliFlowConfigFieldDefinitionByFlag(
  cliFlag: string,
): CliFlowConfigFieldDefinition | undefined {
  return cliFlowConfigFieldDefinitionsByFlag.get(cliFlag)
}

export function listCliFlowConfigFieldDefinitions(
  flowId: string,
): CliFlowConfigFieldDefinition[] {
  const flowDefinition = getCliFlowDefinition(flowId)
  if (!flowDefinition) {
    return []
  }

  return cliFlowConfigFieldDefinitions.filter(
    (definition) =>
      definition.common || flowDefinition.configKeys.includes(definition.key),
  )
}

export function normalizeCliFlowConfig<TFlowId extends CliFlowCommandId>(
  flowId: TFlowId,
  input: Record<string, unknown> | null | undefined,
): CliFlowConfigById[TFlowId] {
  const allowedFields = listCliFlowConfigFieldDefinitions(flowId)
  const output: Record<string, string | number | boolean | string[]> = {}

  if (!isRecord(input)) {
    return output as CliFlowConfigById[TFlowId]
  }

  for (const field of allowedFields) {
    const normalized = normalizeCliFlowConfigFieldValue(
      field,
      input[field.key],
    )

    if (normalized !== undefined) {
      output[field.key] = normalized
    }
  }

  return output as CliFlowConfigById[TFlowId]
}

export function createCliFlowTaskRequest<TFlowId extends CliFlowCommandId>(
  flowId: TFlowId,
  config: CliFlowConfigById[TFlowId],
): CliFlowTaskRequestById[TFlowId] {
  return {
    flowId,
    config,
  }
}

export function createCliFlowTaskPayload<TFlowId extends CliFlowCommandId>(
  flowId: TFlowId,
  config: CliFlowConfigById[TFlowId],
  batch?: CliFlowTaskBatchMetadata,
): CliFlowTaskPayloadById[TFlowId] {
  return {
    kind: 'flow_task',
    flowId,
    config,
    ...(batch ? { batch } : {}),
  }
}

export function normalizeCliFlowTaskPayload(
  value: unknown,
): CliFlowTaskPayload | undefined {
  if (!isRecord(value) || value.kind !== 'flow_task') {
    return undefined
  }

  const flowId =
    typeof value.flowId === 'string' ? value.flowId.trim() : ''
  const flowDefinition = getCliFlowDefinition(flowId)
  if (!flowDefinition) {
    return undefined
  }

  const rawConfig = isRecord(value.config)
    ? value.config
    : isRecord(value.options)
      ? value.options
      : {}
  const batch = normalizeCliFlowTaskBatchMetadata(value.batch)

  return createCliFlowTaskPayload(
    flowDefinition.id,
    normalizeCliFlowConfig(flowDefinition.id, rawConfig),
    batch,
  )
}

export function isCliFlowTaskPayload(
  value: unknown,
): value is CliFlowTaskPayload {
  return Boolean(normalizeCliFlowTaskPayload(value))
}
