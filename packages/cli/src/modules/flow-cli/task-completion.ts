import type { CliFlowCommandId } from './flow-registry'
import type { FlowCommandExecution } from './result-file'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getNestedString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function assertChatGPTRegisterCompletion(
  execution: Pick<FlowCommandExecution, 'result'>,
): void {
  const result = execution.result
  if (!isRecord(result)) {
    throw new Error(
      'ChatGPT registration did not return a structured result payload.',
    )
  }

  const storedIdentity = isRecord(result.storedIdentity)
    ? result.storedIdentity
    : null
  if (!storedIdentity) {
    throw new Error(
      'ChatGPT registration completed without persisting a shared identity.',
    )
  }

  const identityId = getNestedString(storedIdentity, 'id')
  const email = getNestedString(storedIdentity, 'email')
  if (!identityId || !email) {
    throw new Error(
      'ChatGPT registration completed without a usable stored identity summary.',
    )
  }
}

export function assertFlowTaskExecutionSucceeded(
  flowId: CliFlowCommandId,
  execution: Pick<FlowCommandExecution, 'status' | 'result'>,
): void {
  if (execution.status !== 'passed') {
    throw new Error(`Flow ${flowId} did not report a passed execution status.`)
  }

  if (flowId === 'chatgpt-register') {
    assertChatGPTRegisterCompletion(execution)
  }
}
