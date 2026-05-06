import { isOpenAIAddPhoneRequiredError } from '../../state-machine'
import type { CliFlowCommandId } from './flow-registry'

export interface FlowTaskFullRetryDecision {
  reason: string
  message: string
  maxAttempts: number
  configPatch?: Record<string, unknown>
}

export const OPENAI_ADD_PHONE_FULL_RETRY_MAX_ATTEMPTS = 2
export const GOPAY_LINKING_RATE_LIMIT_RETRY_MAX_ATTEMPTS = 2

const openAIAddPhoneFullRetryFlows = new Set<CliFlowCommandId>([
  'chatgpt-invite',
  'codex-oauth',
])

export function getFlowTaskFullRetryDecision(input: {
  flowId: CliFlowCommandId
  error: unknown
}): FlowTaskFullRetryDecision | undefined {
  if (isGoPayTokenizationLinkingRateLimit(input)) {
    return {
      reason: 'chatgpt-team-trial-gopay:gopay-tokenization-rate-limited',
      message:
        'GoPay tokenization was rate-limited by Midtrans; Codey Web is re-queuing the continuation without unlinking GoPay again.',
      maxAttempts: GOPAY_LINKING_RATE_LIMIT_RETRY_MAX_ATTEMPTS,
      configPatch: {
        unlinkBeforeLink: false,
      },
    }
  }

  if (!isOpenAIAddPhoneRequiredError(input.error)) {
    return undefined
  }

  if (!openAIAddPhoneFullRetryFlows.has(input.flowId)) {
    return undefined
  }

  return {
    reason: `${input.flowId}:add-phone-required`,
    message: `OpenAI requested a phone number during the ${formatFlowNameForRetry(input.flowId)} flow; resetting the Codey task for a full retry.`,
    maxAttempts: OPENAI_ADD_PHONE_FULL_RETRY_MAX_ATTEMPTS,
  }
}

function isGoPayTokenizationLinkingRateLimit(input: {
  flowId: CliFlowCommandId
  error: unknown
}): boolean {
  if (input.flowId !== 'chatgpt-team-trial-gopay') {
    return false
  }

  const message = getErrorMessage(input.error)
  return (
    /^GoPay tokenization linking failed:/i.test(message) &&
    /\b(?:HTTP\s*)?429\b/i.test(message)
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === 'string' ? error : ''
}

function formatFlowNameForRetry(flowId: CliFlowCommandId): string {
  if (flowId === 'codex-oauth') {
    return 'Codex OAuth'
  }

  if (flowId === 'chatgpt-invite') {
    return 'ChatGPT invite'
  }

  return flowId
}
