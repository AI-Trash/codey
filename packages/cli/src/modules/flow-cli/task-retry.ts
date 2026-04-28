import { isOpenAIAddPhoneRequiredError } from '../../state-machine'
import type { CliFlowCommandId } from './flow-registry'

export interface FlowTaskFullRetryDecision {
  reason: string
  message: string
  maxAttempts: number
}

export const OPENAI_ADD_PHONE_FULL_RETRY_MAX_ATTEMPTS = 2

const openAIAddPhoneFullRetryFlows = new Set<CliFlowCommandId>([
  'chatgpt-invite',
  'codex-oauth',
])

export function getFlowTaskFullRetryDecision(input: {
  flowId: CliFlowCommandId
  error: unknown
}): FlowTaskFullRetryDecision | undefined {
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

function formatFlowNameForRetry(flowId: CliFlowCommandId): string {
  if (flowId === 'codex-oauth') {
    return 'Codex OAuth'
  }

  if (flowId === 'chatgpt-invite') {
    return 'ChatGPT invite'
  }

  return flowId
}
