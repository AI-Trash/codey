import Enquirer from 'enquirer'

import type { FlowOptions } from '../flow-cli/helpers'
import {
  cliFlowDefinitions,
  listCliFlowConfigFieldDefinitions,
  normalizeCliFlowConfig,
  type CliFlowCommandId,
  type CliFlowConfigFieldDefinition,
  type CliFlowDefinition,
} from '../flow-cli/flow-registry'

export interface ManualFlowTaskInput {
  flowId: CliFlowCommandId
  config: FlowOptions
}

type EnquirerChoice = {
  name: string
  message: string
  hint?: string
}

const flowDescriptionById: Record<CliFlowCommandId, string> = {
  'chatgpt-register':
    'Create a new ChatGPT account and wait for email verification.',
  'chatgpt-login': 'Sign in with a previously shared ChatGPT identity.',
  'chatgpt-login-invite':
    'Sign in with a shared ChatGPT identity and invite workspace members.',
  'codex-oauth': 'Complete Codex OAuth and store the shared session in Codey.',
  noop: 'Open an empty browser page for manual inspection.',
}

const flowOptionLabelByKey: Record<string, string> = {
  chromeDefaultProfile: 'Reuse local Chrome Default profile',
  headless: 'Run browser headless',
  slowMo: 'Slow motion delay',
  har: 'Record HAR file',
  record: 'Keep browser open after completion',
  password: 'Password override',
  verificationTimeoutMs: 'Verification timeout',
  pollIntervalMs: 'Verification poll interval',
  identityId: 'Shared identity ID',
  email: 'Shared identity email',
  inviteEmail: 'Invite email addresses',
  inviteFile: 'Invite CSV/JSON file',
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
  record: 'Keep the browser session open after the flow finishes.',
  password: 'Override the password used by the flow.',
  verificationTimeoutMs:
    'How long to wait for a verification email or approval, in milliseconds.',
  pollIntervalMs:
    'How often to poll for verification updates, in milliseconds.',
  identityId: 'Choose a specific shared identity by ID.',
  email: 'Choose a specific shared identity by email.',
  inviteEmail: 'Enter one or more invite emails separated by commas or lines.',
  inviteFile: 'Path to a CSV or JSON file that contains invite emails.',
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

export function describeManualFlow(flowId: CliFlowCommandId): string {
  return flowDescriptionById[flowId] || humanizeKey(flowId)
}

export function describeManualFlowOption(optionKey: string): string {
  return flowOptionDescriptionByKey[optionKey] || humanizeKey(optionKey)
}

function formatManualFlowChoice(definition: CliFlowDefinition): EnquirerChoice {
  return {
    name: definition.id,
    message: definition.id,
    hint: describeManualFlow(definition.id),
  }
}

function formatManualFlowOptionChoice(
  definition: CliFlowConfigFieldDefinition,
): EnquirerChoice {
  const label =
    flowOptionLabelByKey[definition.key] || humanizeKey(definition.key)
  const scope = definition.common ? 'Common' : 'Flow'

  return {
    name: definition.key,
    message: `${definition.flag}  ${label}`,
    hint: `${scope}: ${describeManualFlowOption(definition.key)}`,
  }
}

export function buildManualFlowChoices(): EnquirerChoice[] {
  return cliFlowDefinitions.map(formatManualFlowChoice)
}

export function buildManualFlowOptionChoices(
  flowId: CliFlowCommandId,
): EnquirerChoice[] {
  return listCliFlowConfigFieldDefinitions(flowId).map(
    formatManualFlowOptionChoice,
  )
}

function normalizeManualFlowPromptValue(
  definition: CliFlowConfigFieldDefinition,
  value: unknown,
): unknown {
  if (definition.type === 'boolean') {
    return value === 'true'
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

async function runEnquirerPrompt<T>(
  config: Record<string, unknown>,
): Promise<T> {
  const prompt = new Enquirer<T>()
  return (await prompt.prompt(config as never)) as T
}

async function promptForFlowId(): Promise<CliFlowCommandId> {
  const answer = await runEnquirerPrompt<{ flowId: CliFlowCommandId }>({
    type: 'select',
    name: 'flowId',
    message: 'Select a local flow to start',
    choices: buildManualFlowChoices(),
  })

  return answer.flowId
}

async function promptForSelectedOptionKeys(
  flowId: CliFlowCommandId,
): Promise<string[]> {
  const choices = buildManualFlowOptionChoices(flowId)
  if (!choices.length) {
    return []
  }

  const answer = await runEnquirerPrompt<{ optionKeys: string[] }>({
    type: 'multiselect',
    name: 'optionKeys',
    message: 'Select config fields to override',
    choices,
    initial: [],
  })

  return Array.isArray(answer.optionKeys) ? answer.optionKeys : []
}

async function promptForOptionValue(
  definition: CliFlowConfigFieldDefinition,
): Promise<unknown> {
  const description = describeManualFlowOption(definition.key)

  if (definition.type === 'boolean') {
    const answer = await runEnquirerPrompt<{ value: string }>({
      type: 'select',
      name: 'value',
      message: `${definition.flag}\n${description}`,
      choices: [
        {
          name: 'true',
          message: 'true',
          hint: 'Enable this option.',
        },
        {
          name: 'false',
          message: 'false',
          hint: 'Disable this option explicitly.',
        },
      ],
    })

    return normalizeManualFlowPromptValue(definition, answer.value)
  }

  const inputSuffix =
    definition.type === 'number'
      ? ' (number)'
      : definition.type === 'stringList'
        ? ' (comma or newline separated)'
        : ''

  const answer = await runEnquirerPrompt<{ value: string }>({
    type: 'input',
    name: 'value',
    message: `${definition.flag}${inputSuffix}\n${description}`,
    validate: (current: string) => {
      const normalized = current.trim()
      if (!normalized) {
        return 'A value is required.'
      }

      if (
        definition.type === 'number' &&
        !Number.isFinite(Number(normalized))
      ) {
        return 'Enter a valid number.'
      }

      return true
    },
  })

  return normalizeManualFlowPromptValue(definition, answer.value)
}

export async function promptForManualFlowTask(): Promise<ManualFlowTaskInput> {
  const flowId = await promptForFlowId()
  const optionKeys = await promptForSelectedOptionKeys(flowId)
  const optionDefinitions = listCliFlowConfigFieldDefinitions(flowId)
  const rawOptions: Record<string, unknown> = {}

  for (const optionKey of optionKeys) {
    const definition = optionDefinitions.find(
      (candidate) => candidate.key === optionKey,
    )
    if (!definition) {
      continue
    }

    rawOptions[optionKey] = await promptForOptionValue(definition)
  }

  return {
    flowId,
    config: normalizeManualFlowAnswers(flowId, rawOptions),
  }
}
