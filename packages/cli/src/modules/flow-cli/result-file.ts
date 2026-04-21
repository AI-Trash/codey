import { writeFileAtomic } from '../../utils/fs'
import {
  redactForOutput,
  sanitizeErrorForOutput,
  type FlowOptions,
} from './helpers'
import type { CliFlowCommandId } from './flow-registry'

const FLOW_RESULT_FILE_ENV = 'CODEY_FLOW_RESULT_JSON_FILE'

export interface FlowCommandExecution<TResult = unknown> {
  flowId: CliFlowCommandId
  command: string
  status: 'passed' | 'failed'
  startedAt: string
  completedAt: string
  durationMs: number
  config: Partial<FlowOptions>
  result?: TResult
  error?: string
}

function calculateDurationMs(startedAt: string, completedAt: string): number {
  const duration = Date.parse(completedAt) - Date.parse(startedAt)
  return Number.isFinite(duration) && duration >= 0 ? duration : 0
}

export function buildFlowCommandExecutionResult<TResult>(
  input: Omit<FlowCommandExecution<TResult>, 'durationMs'>,
): FlowCommandExecution<TResult> {
  return {
    ...input,
    durationMs: calculateDurationMs(input.startedAt, input.completedAt),
  }
}

export function buildFailedFlowCommandExecution(
  input: Omit<FlowCommandExecution<never>, 'status' | 'durationMs'> & {
    error: unknown
  },
): FlowCommandExecution {
  return buildFlowCommandExecutionResult({
    ...input,
    status: 'failed',
    error: sanitizeErrorForOutput(input.error).message,
  })
}

export function writeFlowCommandExecutionResult(
  execution: FlowCommandExecution,
): void {
  const filePath = process.env[FLOW_RESULT_FILE_ENV]?.trim()
  if (!filePath) {
    return
  }

  writeFileAtomic(filePath, JSON.stringify(redactForOutput(execution), null, 2))
}
