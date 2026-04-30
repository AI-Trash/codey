export type CliFlowCommandId =
  | 'chatgpt-register'
  | 'chatgpt-login'
  | 'chatgpt-team-trial'
  | 'chatgpt-invite'
  | 'codex-oauth'
  | 'android-healthcheck'
  | 'noop'

export type CliFlowRuntimeKind = 'browser' | 'android'

export type CliFlowConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'stringList'

export const CHATGPT_TRIAL_CLAIM_METHODS = ['paypal', 'gopay'] as const
export type ChatGPTTrialClaimMethod =
  (typeof CHATGPT_TRIAL_CLAIM_METHODS)[number]

export type CliFlowDisplayNameKey =
  | 'chatgptRegister'
  | 'chatgptLogin'
  | 'chatgptTeamTrial'
  | 'chatgptInvite'
  | 'codexOauth'
  | 'androidHealthcheck'
  | 'noop'

export type CliFlowDescriptionKey =
  | 'chatgptRegister'
  | 'chatgptLogin'
  | 'chatgptTeamTrial'
  | 'chatgptInvite'
  | 'codexOauth'
  | 'androidHealthcheck'
  | 'noop'

export type CliFlowConfigFieldDisplayNameKey =
  | 'chromeDefaultProfile'
  | 'headless'
  | 'slowMo'
  | 'har'
  | 'recordPageContent'
  | 'record'
  | 'restoreStorageState'
  | 'password'
  | 'claimTrial'
  | 'verificationTimeoutMs'
  | 'pollIntervalMs'
  | 'identityId'
  | 'email'
  | 'billingName'
  | 'billingCountry'
  | 'billingAddressLine1'
  | 'billingAddressLine2'
  | 'billingCity'
  | 'billingState'
  | 'billingPostalCode'
  | 'inviteEmail'
  | 'inviteFile'
  | 'pruneUnmanagedWorkspaceMembers'
  | 'workspaceId'
  | 'workspaceIndex'
  | 'redirectPort'
  | 'authorizeUrlOnly'
  | 'appiumServerUrl'
  | 'androidUdid'
  | 'androidDeviceName'
  | 'androidPlatformVersion'
  | 'androidAutomationName'
  | 'androidAppPackage'
  | 'androidAppActivity'
  | 'androidNoReset'

export type CliFlowConfigFieldDescriptionKey =
  | 'chromeDefaultProfile'
  | 'headless'
  | 'slowMo'
  | 'har'
  | 'recordPageContent'
  | 'record'
  | 'restoreStorageState'
  | 'password'
  | 'claimTrial'
  | 'verificationTimeoutMs'
  | 'pollIntervalMs'
  | 'identityId'
  | 'email'
  | 'billingName'
  | 'billingCountry'
  | 'billingAddressLine1'
  | 'billingAddressLine2'
  | 'billingCity'
  | 'billingState'
  | 'billingPostalCode'
  | 'inviteEmail'
  | 'inviteFile'
  | 'pruneUnmanagedWorkspaceMembers'
  | 'workspaceId'
  | 'workspaceIndex'
  | 'redirectPort'
  | 'authorizeUrlOnly'
  | 'appiumServerUrl'
  | 'androidUdid'
  | 'androidDeviceName'
  | 'androidPlatformVersion'
  | 'androidAutomationName'
  | 'androidAppPackage'
  | 'androidAppActivity'
  | 'androidNoReset'

export type CliFlowConfigFieldKey =
  | 'chromeDefaultProfile'
  | 'headless'
  | 'slowMo'
  | 'har'
  | 'recordPageContent'
  | 'record'
  | 'restoreStorageState'
  | 'password'
  | 'claimTrial'
  | 'verificationTimeoutMs'
  | 'pollIntervalMs'
  | 'identityId'
  | 'email'
  | 'billingName'
  | 'billingCountry'
  | 'billingAddressLine1'
  | 'billingAddressLine2'
  | 'billingCity'
  | 'billingState'
  | 'billingPostalCode'
  | 'inviteEmail'
  | 'inviteFile'
  | 'pruneUnmanagedWorkspaceMembers'
  | 'workspaceId'
  | 'workspaceIndex'
  | 'redirectPort'
  | 'authorizeUrlOnly'
  | 'appiumServerUrl'
  | 'androidUdid'
  | 'androidDeviceName'
  | 'androidPlatformVersion'
  | 'androidAutomationName'
  | 'androidAppPackage'
  | 'androidAppActivity'
  | 'androidNoReset'

export interface CliFlowConfigFieldDefinition {
  key: CliFlowConfigFieldKey
  cliFlag: string
  type: CliFlowConfigFieldType
  displayNameKey: CliFlowConfigFieldDisplayNameKey
  descriptionKey?: CliFlowConfigFieldDescriptionKey
  options?: readonly CliFlowConfigFieldOption[]
  common?: boolean
  runtimes?: readonly CliFlowRuntimeKind[]
}

export interface CliFlowConfigFieldOption {
  value: string
  label: string
}

export interface CliFlowDefinition {
  id: CliFlowCommandId
  runtime: CliFlowRuntimeKind
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
   * Save the settled final page.content() HTML into the artifacts directory.
   */
  recordPageContent?: boolean

  /**
   * Keep the browser open after the flow finishes.
   */
  record?: boolean
}

export interface AndroidCommonFlowConfig {
  /**
   * Appium server URL, for example http://127.0.0.1:4723.
   */
  appiumServerUrl?: string

  /**
   * Android device UDID. Leave unset when Appium can pick the target device.
   */
  androidUdid?: string

  /**
   * Android device name sent to Appium capabilities.
   */
  androidDeviceName?: string

  /**
   * Android platform version sent to Appium capabilities.
   */
  androidPlatformVersion?: string

  /**
   * Appium automation backend. UiAutomator2 is the default Android driver.
   */
  androidAutomationName?: string

  /**
   * Optional app package to launch for app-specific flows.
   */
  androidAppPackage?: string

  /**
   * Optional app activity to launch for app-specific flows.
   */
  androidAppActivity?: string

  /**
   * Preserve app/device state between runs.
   */
  androidNoReset?: boolean
}

export interface ChatGPTTeamTrialBillingFlowConfig {
  /**
   * Billing name to send to Stripe when the checkout address form exposes it.
   */
  billingName?: string

  /**
   * ISO 3166-1 alpha-2 billing country code, for example "IE" or "US".
   */
  billingCountry?: string

  /**
   * Billing street address line 1.
   */
  billingAddressLine1?: string

  /**
   * Optional billing street address line 2.
   */
  billingAddressLine2?: string

  /**
   * Billing city/locality.
   */
  billingCity?: string

  /**
   * Billing state/province/administrative area when required by country.
   */
  billingState?: string

  /**
   * Billing postal or ZIP code.
   */
  billingPostalCode?: string
}

/**
 * Configuration for creating a brand-new ChatGPT account.
 */
export interface ChatGPTRegisterFlowConfig
  extends CommonFlowConfig, ChatGPTTeamTrialBillingFlowConfig {
  /**
   * Override the generated password for the new identity.
   */
  password?: string

  /**
   * Continue into the first eligible ChatGPT trial checkout after registration
   * using the selected payment branch.
   */
  claimTrial?: ChatGPTTrialClaimMethod

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

  /**
   * Load a matching local ChatGPT storage state before normal login.
   */
  restoreStorageState?: boolean
}

/**
 * Configuration for signing in and completing the trial checkout handoff.
 */
export interface ChatGPTTeamTrialFlowConfig
  extends ChatGPTLoginFlowConfig, ChatGPTTeamTrialBillingFlowConfig {}

/**
 * Configuration for signing in and inviting ChatGPT workspace members.
 */
export interface ChatGPTInviteFlowConfig extends ChatGPTLoginFlowConfig {
  /**
   * Invite one or more email addresses after login succeeds.
   */
  inviteEmail?: string[]

  /**
   * Read invite email addresses from a CSV or JSON file.
   */
  inviteFile?: string

  /**
   * Remove existing ChatGPT workspace users that are not in the managed invite
   * list before sending new invites.
   */
  pruneUnmanagedWorkspaceMembers?: boolean
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
   * Explicit OpenAI workspace id to request during Codex OAuth.
   */
  workspaceId?: string

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

/**
 * Configuration for opening an Appium Android session and reporting device
 * session details.
 */
export interface AndroidHealthcheckFlowConfig extends AndroidCommonFlowConfig {}

export interface CliFlowConfigById {
  'chatgpt-register': ChatGPTRegisterFlowConfig
  'chatgpt-login': ChatGPTLoginFlowConfig
  'chatgpt-team-trial': ChatGPTTeamTrialFlowConfig
  'chatgpt-invite': ChatGPTInviteFlowConfig
  'codex-oauth': CodexOAuthFlowConfig
  'android-healthcheck': AndroidHealthcheckFlowConfig
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

export interface CliFlowTaskExternalServices {
  sub2api?: {
    source: 'app'
  }
}

export interface CliFlowTaskWorkspaceMetadata {
  recordId?: string
  workspaceId?: string
  label?: string
  ownerIdentityId?: string
  automation?: {
    id?: string
    kind?: string
    phase?: string
    connectionId?: string
    targetMemberCount?: number
  }
}

export interface CliFlowTaskIdentityMaintenanceMetadata {
  kind: 'identity-maintenance'
  runId?: string
  identityId: string
  email?: string
}

export interface CliFlowTaskMetadata {
  workspace?: CliFlowTaskWorkspaceMetadata
  identityMaintenance?: CliFlowTaskIdentityMaintenanceMetadata
}

export const DEFAULT_CLI_FLOW_TASK_COUNT = 1
export const DEFAULT_CLI_FLOW_TASK_PARALLELISM = 1
export const MAX_CLI_FLOW_TASK_BATCH_SIZE = 100
export const MAX_CLI_FLOW_TASK_PARALLELISM = 10
export const DEFAULT_CLI_BROWSER_LIMIT = 10
export const MAX_CLI_FLOW_TASK_BATCH_METADATA_SIZE = 1_000_000

export type CliFlowTaskRequestById = {
  [FlowId in CliFlowCommandId]: {
    flowId: FlowId
    config: CliFlowConfigById[FlowId]
  }
}

export type CliFlowTaskRequest = CliFlowTaskRequestById[CliFlowCommandId]

export type CliFlowTaskPayloadById = {
  [FlowId in CliFlowCommandId]: {
    kind: 'flow_task'
    flowId: FlowId
    config: CliFlowConfigById[FlowId]
    batch?: CliFlowTaskBatchMetadata
    externalServices?: CliFlowTaskExternalServices
    metadata?: CliFlowTaskMetadata
  }
}

export type CliFlowTaskPayload = CliFlowTaskPayloadById[CliFlowCommandId]

export const cliFlowCommonConfigFieldDefinitions = [
  {
    key: 'chromeDefaultProfile',
    cliFlag: '--chromeDefaultProfile',
    type: 'boolean',
    displayNameKey: 'chromeDefaultProfile',
    descriptionKey: 'chromeDefaultProfile',
    common: true,
    runtimes: ['browser'],
  },
  {
    key: 'headless',
    cliFlag: '--headless',
    type: 'boolean',
    displayNameKey: 'headless',
    descriptionKey: 'headless',
    common: true,
    runtimes: ['browser'],
  },
  {
    key: 'slowMo',
    cliFlag: '--slowMo',
    type: 'number',
    displayNameKey: 'slowMo',
    descriptionKey: 'slowMo',
    common: true,
    runtimes: ['browser'],
  },
  {
    key: 'har',
    cliFlag: '--har',
    type: 'boolean',
    displayNameKey: 'har',
    descriptionKey: 'har',
    common: true,
    runtimes: ['browser'],
  },
  {
    key: 'recordPageContent',
    cliFlag: '--recordPageContent',
    type: 'boolean',
    displayNameKey: 'recordPageContent',
    descriptionKey: 'recordPageContent',
    common: true,
    runtimes: ['browser'],
  },
  {
    key: 'record',
    cliFlag: '--record',
    type: 'boolean',
    displayNameKey: 'record',
    descriptionKey: 'record',
    common: true,
    runtimes: ['browser'],
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
    key: 'claimTrial',
    cliFlag: '--claimTrial',
    type: 'select',
    displayNameKey: 'claimTrial',
    descriptionKey: 'claimTrial',
    options: [
      { value: 'paypal', label: 'PayPal' },
      { value: 'gopay', label: 'GoPay' },
    ],
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
    key: 'billingName',
    cliFlag: '--billingName',
    type: 'string',
    displayNameKey: 'billingName',
    descriptionKey: 'billingName',
  },
  {
    key: 'billingCountry',
    cliFlag: '--billingCountry',
    type: 'string',
    displayNameKey: 'billingCountry',
    descriptionKey: 'billingCountry',
  },
  {
    key: 'billingAddressLine1',
    cliFlag: '--billingAddressLine1',
    type: 'string',
    displayNameKey: 'billingAddressLine1',
    descriptionKey: 'billingAddressLine1',
  },
  {
    key: 'billingAddressLine2',
    cliFlag: '--billingAddressLine2',
    type: 'string',
    displayNameKey: 'billingAddressLine2',
    descriptionKey: 'billingAddressLine2',
  },
  {
    key: 'billingCity',
    cliFlag: '--billingCity',
    type: 'string',
    displayNameKey: 'billingCity',
    descriptionKey: 'billingCity',
  },
  {
    key: 'billingState',
    cliFlag: '--billingState',
    type: 'string',
    displayNameKey: 'billingState',
    descriptionKey: 'billingState',
  },
  {
    key: 'billingPostalCode',
    cliFlag: '--billingPostalCode',
    type: 'string',
    displayNameKey: 'billingPostalCode',
    descriptionKey: 'billingPostalCode',
  },
  {
    key: 'restoreStorageState',
    cliFlag: '--restoreStorageState',
    type: 'boolean',
    displayNameKey: 'restoreStorageState',
    descriptionKey: 'restoreStorageState',
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
    key: 'pruneUnmanagedWorkspaceMembers',
    cliFlag: '--pruneUnmanagedWorkspaceMembers',
    type: 'boolean',
    displayNameKey: 'pruneUnmanagedWorkspaceMembers',
    descriptionKey: 'pruneUnmanagedWorkspaceMembers',
  },
  {
    key: 'workspaceId',
    cliFlag: '--workspaceId',
    type: 'string',
    displayNameKey: 'workspaceId',
    descriptionKey: 'workspaceId',
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
  {
    key: 'appiumServerUrl',
    cliFlag: '--appiumServerUrl',
    type: 'string',
    displayNameKey: 'appiumServerUrl',
    descriptionKey: 'appiumServerUrl',
  },
  {
    key: 'androidUdid',
    cliFlag: '--androidUdid',
    type: 'string',
    displayNameKey: 'androidUdid',
    descriptionKey: 'androidUdid',
  },
  {
    key: 'androidDeviceName',
    cliFlag: '--androidDeviceName',
    type: 'string',
    displayNameKey: 'androidDeviceName',
    descriptionKey: 'androidDeviceName',
  },
  {
    key: 'androidPlatformVersion',
    cliFlag: '--androidPlatformVersion',
    type: 'string',
    displayNameKey: 'androidPlatformVersion',
    descriptionKey: 'androidPlatformVersion',
  },
  {
    key: 'androidAutomationName',
    cliFlag: '--androidAutomationName',
    type: 'string',
    displayNameKey: 'androidAutomationName',
    descriptionKey: 'androidAutomationName',
  },
  {
    key: 'androidAppPackage',
    cliFlag: '--androidAppPackage',
    type: 'string',
    displayNameKey: 'androidAppPackage',
    descriptionKey: 'androidAppPackage',
  },
  {
    key: 'androidAppActivity',
    cliFlag: '--androidAppActivity',
    type: 'string',
    displayNameKey: 'androidAppActivity',
    descriptionKey: 'androidAppActivity',
  },
  {
    key: 'androidNoReset',
    cliFlag: '--androidNoReset',
    type: 'boolean',
    displayNameKey: 'androidNoReset',
    descriptionKey: 'androidNoReset',
  },
] as const satisfies readonly CliFlowConfigFieldDefinition[]

export const cliFlowDefinitions = [
  {
    id: 'chatgpt-register',
    runtime: 'browser',
    displayNameKey: 'chatgptRegister',
    descriptionKey: 'chatgptRegister',
    configKeys: [
      'password',
      'claimTrial',
      'verificationTimeoutMs',
      'pollIntervalMs',
      'billingName',
      'billingCountry',
      'billingAddressLine1',
      'billingAddressLine2',
      'billingCity',
      'billingState',
      'billingPostalCode',
    ],
  },
  {
    id: 'chatgpt-login',
    runtime: 'browser',
    displayNameKey: 'chatgptLogin',
    descriptionKey: 'chatgptLogin',
    configKeys: ['identityId', 'email', 'restoreStorageState'],
  },
  {
    id: 'chatgpt-team-trial',
    runtime: 'browser',
    displayNameKey: 'chatgptTeamTrial',
    descriptionKey: 'chatgptTeamTrial',
    configKeys: [
      'identityId',
      'email',
      'restoreStorageState',
      'billingName',
      'billingCountry',
      'billingAddressLine1',
      'billingAddressLine2',
      'billingCity',
      'billingState',
      'billingPostalCode',
    ],
  },
  {
    id: 'chatgpt-invite',
    runtime: 'browser',
    displayNameKey: 'chatgptInvite',
    descriptionKey: 'chatgptInvite',
    configKeys: [
      'identityId',
      'email',
      'restoreStorageState',
      'inviteEmail',
      'inviteFile',
      'pruneUnmanagedWorkspaceMembers',
    ],
  },
  {
    id: 'codex-oauth',
    runtime: 'browser',
    displayNameKey: 'codexOauth',
    descriptionKey: 'codexOauth',
    configKeys: [
      'identityId',
      'email',
      'verificationTimeoutMs',
      'pollIntervalMs',
      'workspaceId',
      'workspaceIndex',
      'redirectPort',
      'authorizeUrlOnly',
    ],
  },
  {
    id: 'android-healthcheck',
    runtime: 'android',
    displayNameKey: 'androidHealthcheck',
    descriptionKey: 'androidHealthcheck',
    configKeys: [
      'appiumServerUrl',
      'androidUdid',
      'androidDeviceName',
      'androidPlatformVersion',
      'androidAutomationName',
      'androidAppPackage',
      'androidAppActivity',
      'androidNoReset',
    ],
  },
  {
    id: 'noop',
    runtime: 'browser',
    displayNameKey: 'noop',
    descriptionKey: 'noop',
    configKeys: [],
  },
] as const satisfies readonly CliFlowDefinition[]

const cliFlowDefinitionsById = new Map(
  cliFlowDefinitions.map((definition) => [definition.id, definition]),
)

const cliFlowConfigFieldDefinitionsByKey = new Map(
  cliFlowConfigFieldDefinitions.map((definition) => [
    definition.key,
    definition,
  ]),
)

const cliFlowConfigFieldDefinitionsByFlag = new Map(
  cliFlowConfigFieldDefinitions.map((definition) => [
    definition.cliFlag,
    definition,
  ]),
)

export function normalizeCliFlowCommandId(
  flowId: string,
): CliFlowCommandId | undefined {
  const normalized = flowId.trim()
  const canonical =
    normalized === 'chatgpt-login-invite' ? 'chatgpt-invite' : normalized

  if (cliFlowDefinitionsById.has(canonical as CliFlowCommandId)) {
    return canonical as CliFlowCommandId
  }

  return undefined
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

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeClaimTrialMethod(value: unknown): string | undefined {
  if (typeof value === 'boolean') {
    return value ? 'paypal' : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized || ['0', 'false', 'no', 'off', 'none'].includes(normalized)) {
    return undefined
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return 'paypal'
  }

  return CHATGPT_TRIAL_CLAIM_METHODS.find((method) => method === normalized)
}

function normalizeSelect(
  definition: CliFlowConfigFieldDefinition,
  value: unknown,
): string | undefined {
  if (definition.key === 'claimTrial') {
    return normalizeClaimTrialMethod(value)
  }

  const normalized = normalizeString(value)
  if (!normalized) {
    return undefined
  }

  return definition.options?.some((option) => option.value === normalized)
    ? normalized
    : undefined
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

  if (definition.type === 'select') {
    return normalizeSelect(definition, value)
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
      MAX_CLI_FLOW_TASK_BATCH_METADATA_SIZE,
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
    MAX_CLI_FLOW_TASK_BATCH_METADATA_SIZE,
  )
  const sequence = normalizePositiveInteger(
    value.sequence,
    MAX_CLI_FLOW_TASK_BATCH_METADATA_SIZE,
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
  const normalized = normalizeCliFlowCommandId(flowId)
  return normalized ? cliFlowDefinitionsById.get(normalized) : undefined
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
  return cliFlowConfigFieldDefinitionsByFlag.get(
    cliFlag as (typeof cliFlowConfigFieldDefinitions)[number]['cliFlag'],
  )
}

export function listCliFlowConfigFieldDefinitions(
  flowId: string,
): CliFlowConfigFieldDefinition[] {
  const flowDefinition = getCliFlowDefinition(flowId)
  if (!flowDefinition) {
    return []
  }

  return cliFlowConfigFieldDefinitions.filter((definition) => {
    const field = definition as CliFlowConfigFieldDefinition
    const commonForRuntime =
      field.common &&
      (!field.runtimes || field.runtimes.includes(flowDefinition.runtime))
    return commonForRuntime || flowDefinition.configKeys.includes(field.key)
  })
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
    const rawValue =
      input[field.key] ??
      (flowId === 'chatgpt-register' && field.key === 'claimTrial'
        ? input.claimTeamTrial
        : undefined)
    const normalized = normalizeCliFlowConfigFieldValue(field, rawValue)

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
  } as CliFlowTaskRequestById[TFlowId]
}

export function createCliFlowTaskPayload<TFlowId extends CliFlowCommandId>(
  flowId: TFlowId,
  config: CliFlowConfigById[TFlowId],
  batch?: CliFlowTaskBatchMetadata,
  externalServices?: CliFlowTaskExternalServices,
  metadata?: CliFlowTaskMetadata,
): CliFlowTaskPayloadById[TFlowId] {
  return {
    kind: 'flow_task',
    flowId,
    config,
    ...(batch ? { batch } : {}),
    ...(externalServices ? { externalServices } : {}),
    ...(metadata ? { metadata } : {}),
  } as CliFlowTaskPayloadById[TFlowId]
}

function normalizeOptionalMetadataString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeOptionalMetadataNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}

function normalizeCliFlowTaskMetadata(
  value: unknown,
): CliFlowTaskMetadata | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const workspace = isRecord(value.workspace) ? value.workspace : undefined
  const identityMaintenance = isRecord(value.identityMaintenance)
    ? value.identityMaintenance
    : undefined
  const normalizedIdentityMaintenance = identityMaintenance
    ? normalizeCliFlowTaskIdentityMaintenanceMetadata(identityMaintenance)
    : undefined

  if (!workspace && !normalizedIdentityMaintenance) {
    return undefined
  }

  const normalizedWorkspace = workspace
    ? normalizeCliFlowTaskWorkspaceMetadata(workspace)
    : undefined

  return {
    ...(normalizedWorkspace ? { workspace: normalizedWorkspace } : {}),
    ...(normalizedIdentityMaintenance
      ? { identityMaintenance: normalizedIdentityMaintenance }
      : {}),
  }
}

function normalizeCliFlowTaskIdentityMaintenanceMetadata(
  value: Record<string, unknown>,
): CliFlowTaskIdentityMaintenanceMetadata | undefined {
  if (value.kind !== 'identity-maintenance') {
    return undefined
  }

  const identityId = normalizeOptionalMetadataString(value.identityId)
  if (!identityId) {
    return undefined
  }

  const runId = normalizeOptionalMetadataString(value.runId)
  const email = normalizeOptionalMetadataString(value.email)

  return {
    kind: 'identity-maintenance',
    identityId,
    ...(runId ? { runId } : {}),
    ...(email ? { email } : {}),
  }
}

function normalizeCliFlowTaskWorkspaceMetadata(
  workspace: Record<string, unknown>,
): CliFlowTaskWorkspaceMetadata | undefined {
  const recordId = normalizeOptionalMetadataString(workspace.recordId)
  const workspaceId = normalizeOptionalMetadataString(workspace.workspaceId)
  const label = normalizeOptionalMetadataString(workspace.label)
  const ownerIdentityId = normalizeOptionalMetadataString(
    workspace.ownerIdentityId,
  )
  const automation = isRecord(workspace.automation)
    ? workspace.automation
    : undefined
  const automationId = normalizeOptionalMetadataString(automation?.id)
  const automationKind = normalizeOptionalMetadataString(automation?.kind)
  const automationPhase = normalizeOptionalMetadataString(automation?.phase)
  const automationConnectionId = normalizeOptionalMetadataString(
    automation?.connectionId,
  )
  const automationTargetMemberCount = normalizeOptionalMetadataNumber(
    automation?.targetMemberCount,
  )
  const normalizedAutomation =
    automationId ||
    automationKind ||
    automationPhase ||
    automationConnectionId ||
    automationTargetMemberCount
      ? {
          ...(automationId ? { id: automationId } : {}),
          ...(automationKind ? { kind: automationKind } : {}),
          ...(automationPhase ? { phase: automationPhase } : {}),
          ...(automationConnectionId
            ? { connectionId: automationConnectionId }
            : {}),
          ...(automationTargetMemberCount
            ? { targetMemberCount: automationTargetMemberCount }
            : {}),
        }
      : undefined
  const normalizedWorkspace: CliFlowTaskWorkspaceMetadata = {
    ...(recordId ? { recordId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(label ? { label } : {}),
    ...(ownerIdentityId ? { ownerIdentityId } : {}),
    ...(normalizedAutomation ? { automation: normalizedAutomation } : {}),
  }

  return Object.keys(normalizedWorkspace).length
    ? normalizedWorkspace
    : undefined
}

function normalizeCliFlowTaskExternalServices(
  value: unknown,
): CliFlowTaskExternalServices | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const sub2api = isRecord(value.sub2api) ? value.sub2api : undefined
  const source = sub2api?.source
  if (source !== 'app') {
    return undefined
  }

  return {
    sub2api: {
      source: 'app',
    },
  }
}

export function normalizeCliFlowTaskPayload(
  value: unknown,
): CliFlowTaskPayload | undefined {
  if (!isRecord(value) || value.kind !== 'flow_task') {
    return undefined
  }

  const flowId = typeof value.flowId === 'string' ? value.flowId.trim() : ''
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
  const externalServices = normalizeCliFlowTaskExternalServices(
    value.externalServices,
  )
  const metadata = normalizeCliFlowTaskMetadata(value.metadata)

  return createCliFlowTaskPayload(
    flowDefinition.id,
    normalizeCliFlowConfig(flowDefinition.id, rawConfig),
    batch,
    externalServices,
    metadata,
  )
}

export function isCliFlowTaskPayload(
  value: unknown,
): value is CliFlowTaskPayload {
  return Boolean(normalizeCliFlowTaskPayload(value))
}
