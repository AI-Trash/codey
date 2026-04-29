import type { FlowOptions } from '../flow-cli/helpers'
import {
  cliFlowDefinitions,
  MAX_CLI_FLOW_TASK_BATCH_SIZE,
  listCliFlowConfigFieldDefinitions,
  normalizeCliFlowConfig,
  type CliFlowCommandId,
  type CliFlowConfigFieldDefinition,
  type CliFlowDefinition,
} from '../flow-cli/flow-registry'
import type { PromptChoice, PromptSession } from './prompt-io'

export interface ManualFlowTaskInput {
  flowId: CliFlowCommandId
  config: FlowOptions
  repeatCount: number
}

export interface ManualFlowChoice {
  name: string
  message: string
  hint?: string
}

const flowDescriptionById: Record<CliFlowCommandId, string> = {
  'chatgpt-register':
    'Create a new ChatGPT account and wait for email verification.',
  'chatgpt-login': 'Sign in with a previously shared ChatGPT identity.',
  'chatgpt-team-trial': 'Sign in and claim the first eligible ChatGPT trial.',
  'chatgpt-invite':
    'Sign in with a shared ChatGPT identity and invite workspace members.',
  'codex-oauth': 'Complete Codex OAuth and store the shared session in Codey.',
  noop: 'Open an empty browser page for manual inspection.',
}

const flowOptionLabelByKey: Record<string, string> = {
  chromeDefaultProfile: 'Reuse local Chrome Default profile',
  headless: 'Run browser headless',
  slowMo: 'Slow motion delay',
  har: 'Record HAR file',
  recordPageContent: 'Record stable page HTML',
  record: 'Keep browser open after completion',
  restoreStorageState: 'Restore local ChatGPT storage state',
  password: 'Password override',
  claimTrial: 'Claim ChatGPT trial after registration',
  verificationTimeoutMs: 'Verification timeout',
  pollIntervalMs: 'Verification poll interval',
  identityId: 'Shared identity ID',
  email: 'Shared identity email',
  billingName: 'Billing name',
  billingCountry: 'Billing country',
  billingAddressLine1: 'Billing address line 1',
  billingAddressLine2: 'Billing address line 2',
  billingCity: 'Billing city',
  billingState: 'Billing state',
  billingPostalCode: 'Billing postal code',
  inviteEmail: 'Invite email addresses',
  inviteFile: 'Invite CSV/JSON file',
  pruneUnmanagedWorkspaceMembers: 'Prune unmanaged workspace members',
  workspaceId: 'Codex workspace ID',
  workspaceIndex: 'Codex workspace index',
  redirectPort: 'OAuth redirect port',
  authorizeUrlOnly: 'Print authorize URL only and exit',
}

const flowOptionDescriptionByKey: Record<string, string> = {
  chromeDefaultProfile:
    'Clone the local Chrome Default profile into the automation session.',
  headless: 'Run the browser without a visible window.',
  slowMo: 'Apply a delay in milliseconds between browser actions.',
  har: 'Write a HAR file for this run.',
  recordPageContent:
    'Save page.content() after the final page settles into the artifacts directory.',
  record: 'Keep the browser session open after the flow finishes.',
  restoreStorageState:
    'Load a matching local ChatGPT storage state before normal login.',
  password: 'Override the password used by the flow.',
  claimTrial:
    'After registration, check Team then Plus trial coupons and continue with the first eligible checkout.',
  verificationTimeoutMs:
    'How long to wait for a verification email or approval, in milliseconds.',
  pollIntervalMs:
    'How often to poll for verification updates, in milliseconds.',
  identityId: 'Choose a specific shared identity by ID.',
  email: 'Choose a specific shared identity by email.',
  billingName: 'Checkout billing name, if requested.',
  billingCountry: 'Checkout billing country code.',
  billingAddressLine1: 'Checkout billing street address line 1.',
  billingAddressLine2: 'Checkout billing street address line 2.',
  billingCity: 'Checkout billing city/locality.',
  billingState: 'Checkout billing state or province.',
  billingPostalCode: 'Checkout billing postal or ZIP code.',
  inviteEmail: 'Enter one or more invite emails separated by commas or lines.',
  inviteFile: 'Path to a CSV or JSON file that contains invite emails.',
  pruneUnmanagedWorkspaceMembers:
    'Remove existing ChatGPT workspace users that are not in the invite list before inviting.',
  workspaceId: 'Explicit OpenAI workspace ID to request during Codex OAuth.',
  workspaceIndex: '1-based Codex workspace position to select.',
  redirectPort: 'Local port to use for the OAuth redirect callback.',
  authorizeUrlOnly: 'Print the authorize URL and exit before browser login.',
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toPromptChoices<TValue extends string>(
  choices: readonly ManualFlowChoice[],
): PromptChoice<TValue>[] {
  return choices.map((choice) => ({
    value: choice.name as TValue,
    label: choice.message,
    hint: choice.hint,
  }))
}

function toPromptChoice(definition: ManualFlowChoice): PromptChoice {
  return {
    value: definition.name,
    label: definition.message,
    hint: definition.hint,
  }
}

export function describeManualFlow(flowId: CliFlowCommandId): string {
  return flowDescriptionById[flowId] || humanizeKey(flowId)
}

export function describeManualFlowOption(optionKey: string): string {
  return flowOptionDescriptionByKey[optionKey] || humanizeKey(optionKey)
}

export function supportsManualFlowBatching(flowId: CliFlowCommandId): boolean {
  return flowId === 'chatgpt-register'
}

function formatManualFlowChoice(
  definition: CliFlowDefinition,
): ManualFlowChoice {
  return {
    name: definition.id,
    message: definition.id,
    hint: describeManualFlow(definition.id),
  }
}

function formatManualFlowOptionChoice(
  definition: CliFlowConfigFieldDefinition,
): ManualFlowChoice {
  const label =
    flowOptionLabelByKey[definition.key] || humanizeKey(definition.key)
  const scope = definition.common ? 'Common' : 'Flow'

  return {
    name: definition.key,
    message: `${definition.cliFlag}  ${label}`,
    hint: `${scope}: ${describeManualFlowOption(definition.key)}`,
  }
}

export function buildManualFlowChoices(): ManualFlowChoice[] {
  return cliFlowDefinitions.map(formatManualFlowChoice)
}

export function buildManualFlowOptionChoices(
  flowId: CliFlowCommandId,
): ManualFlowChoice[] {
  return listCliFlowConfigFieldDefinitions(flowId).map(
    formatManualFlowOptionChoice,
  )
}

function normalizeManualFlowPromptValue(
  definition: CliFlowConfigFieldDefinition,
  value: unknown,
): unknown {
  if (definition.type === 'boolean') {
    return value === 'true' || value === true
  }

  if (definition.type === 'stringList') {
    return typeof value === 'string' ? value : undefined
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  return value
}

export function normalizeManualFlowAnswers(
  flowId: CliFlowCommandId,
  answers: Record<string, unknown>,
): FlowOptions {
  return normalizeCliFlowConfig(flowId, answers) as FlowOptions
}

export function normalizeManualFlowRepeatCount(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return Math.min(value, MAX_CLI_FLOW_TASK_BATCH_SIZE)
  }

  if (typeof value !== 'string') {
    return 1
  }

  const normalized = value.trim()
  if (!normalized) {
    return 1
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 1
  }

  return Math.min(parsed, MAX_CLI_FLOW_TASK_BATCH_SIZE)
}

async function promptForFlowId(
  prompts: PromptSession,
): Promise<CliFlowCommandId> {
  return prompts.select<CliFlowCommandId>({
    message: 'Select a local flow to start.',
    choices: toPromptChoices<CliFlowCommandId>(buildManualFlowChoices()),
  })
}

async function promptForRepeatCount(
  prompts: PromptSession,
  flowId: CliFlowCommandId,
): Promise<number> {
  if (!supportsManualFlowBatching(flowId)) {
    return 1
  }

  const answer = await prompts.input({
    message: 'How many local registration tasks should Codey queue?',
    initial: '1',
    validate: (current) => {
      if (!current) {
        return true
      }

      const parsed = Number.parseInt(current, 10)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return 'Enter a whole number greater than 0.'
      }

      if (parsed > MAX_CLI_FLOW_TASK_BATCH_SIZE) {
        return `Enter a value from 1 to ${MAX_CLI_FLOW_TASK_BATCH_SIZE}.`
      }

      return true
    },
  })

  return normalizeManualFlowRepeatCount(answer)
}

async function promptForSelectedOptionKeys(
  prompts: PromptSession,
  flowId: CliFlowCommandId,
): Promise<string[]> {
  const choices = buildManualFlowOptionChoices(flowId)
  if (!choices.length) {
    return []
  }

  return prompts.multiSelect({
    message:
      'Select config fields to override. Press Enter without input to keep defaults.',
    choices: choices.map(toPromptChoice),
    allowEmpty: true,
  })
}

async function promptForOptionValue(
  prompts: PromptSession,
  definition: CliFlowConfigFieldDefinition,
): Promise<unknown> {
  const description = describeManualFlowOption(definition.key)
  const message = `${definition.cliFlag}\n${description}`

  if (definition.type === 'boolean') {
    const answer = await prompts.select<'true' | 'false'>({
      message,
      choices: [
        {
          value: 'true',
          label: 'true',
          hint: 'Enable this option.',
        },
        {
          value: 'false',
          label: 'false',
          hint: 'Disable this option explicitly.',
        },
      ],
    })

    return normalizeManualFlowPromptValue(definition, answer)
  }

  const inputSuffix =
    definition.type === 'number'
      ? ' (number)'
      : definition.type === 'stringList'
        ? ' (comma or newline separated)'
        : ''

  const answer = await prompts.input({
    message: `${message}${inputSuffix}`,
    validate: (current) => {
      if (!current) {
        return 'A value is required.'
      }

      if (definition.type === 'number' && !Number.isFinite(Number(current))) {
        return 'Enter a valid number.'
      }

      return true
    },
  })

  return normalizeManualFlowPromptValue(definition, answer)
}

export async function promptForManualFlowTask(
  prompts: PromptSession,
): Promise<ManualFlowTaskInput> {
  const flowId = await promptForFlowId(prompts)
  const repeatCount = await promptForRepeatCount(prompts, flowId)
  const optionKeys = await promptForSelectedOptionKeys(prompts, flowId)
  const optionDefinitions = listCliFlowConfigFieldDefinitions(flowId)
  const rawOptions: Record<string, unknown> = {}

  for (const optionKey of optionKeys) {
    const definition = optionDefinitions.find(
      (candidate) => candidate.key === optionKey,
    )
    if (!definition) {
      continue
    }

    rawOptions[optionKey] = await promptForOptionValue(prompts, definition)
  }

  return {
    flowId,
    config: normalizeManualFlowAnswers(flowId, rawOptions),
    repeatCount,
  }
}
