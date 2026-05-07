import type { RuntimeConfigOverrides } from '../../cli/src/config'

export type { CliRuntimeConfig } from '../../cli/src/config'

export const desktopFlowCommandIds = [
  'chatgpt-register',
  'chatgpt-register-hosted-checkouts',
  'chatgpt-login',
  'chatgpt-team-trial',
  'chatgpt-team-trial-gopay',
  'chatgpt-invite',
  'codex-oauth',
  'android-healthcheck',
  'noop',
] as const

export type DesktopFlowCommandId = (typeof desktopFlowCommandIds)[number]

export type DesktopFlowRuntimeKind = 'browser' | 'android'

export type DesktopFlowTaskExternalServices = Record<string, unknown>

export type DesktopFlowTaskMetadata = Record<string, unknown>

export interface DesktopFlowProgressUpdate {
  status?: string
  state?: string
  event?: string
  message?: string
  attempt?: number
  error?: string
  fromState?: string
  toState?: string
}

export type DesktopFlowProgressReporter = (
  update: DesktopFlowProgressUpdate,
) => void

export interface DesktopFlowOptions {
  config?: string
  profile?: string
  chromeDefaultProfile?: string | boolean
  proxyTag?: string
  headless?: string | boolean
  slowMo?: string | number | boolean
  har?: string | boolean
  record?: string | boolean
  recordPageContent?: string | boolean
  restoreStorageState?: string | boolean
  waitMs?: number
  verificationTimeoutMs?: number
  pollIntervalMs?: number
  paymentRedirectUrl?: string
  unlinkBeforeLink?: string | boolean
  authorizeUrlOnly?: boolean
  password?: string
  claimTrial?: string | boolean
  claimTeamTrial?: string | boolean
  identityId?: string
  email?: string
  billingName?: string
  billingCountry?: string
  billingAddressLine1?: string
  billingAddressLine2?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  hostedCheckoutCountry?: string[]
  hostedCheckoutReview?: string | boolean
  preserveCheckoutBillingCountry?: boolean
  workspaceId?: string
  workspaceIndex?: number
  target?: string
  redirectPort?: number
  inviteEmail?: string[]
  inviteFile?: string
  pruneUnmanagedWorkspaceMembers?: boolean
  chatgptStorageStatePath?: string
  chatgptStorageStateIdentityId?: string
  chatgptStorageStateEmail?: string
  autoSelectFirstWorkspace?: boolean
  taskMetadata?: DesktopFlowTaskMetadata
  appiumServerUrl?: string
  androidUdid?: string
  androidDeviceName?: string
  androidPlatformVersion?: string
  androidAutomationName?: string
  androidAppPackage?: string
  androidAppActivity?: string
  androidNoReset?: string | boolean
  progressReporter?: DesktopFlowProgressReporter
  runtimeConfigOverrides?: RuntimeConfigOverrides
  [key: string]: unknown
}

const desktopFlowCommandIdSet = new Set<string>(desktopFlowCommandIds)

export function isDesktopFlowCommandId(
  flowId: string,
): flowId is DesktopFlowCommandId {
  return desktopFlowCommandIdSet.has(flowId)
}
