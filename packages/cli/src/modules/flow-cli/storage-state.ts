import type { CliFlowCommandId } from './flow-registry'
import type { FlowOptions } from './helpers'
import {
  resolveStoredChatGPTIdentity,
  type StoredChatGPTIdentitySummary,
} from '../credentials'
import {
  resolveLocalChatGPTStorageState,
  type LocalChatGPTStorageStateEntry,
} from '../chatgpt/storage-state'

export interface PreparedFlowStorageState {
  options: FlowOptions
  storedIdentity?: StoredChatGPTIdentitySummary
  storageState?: LocalChatGPTStorageStateEntry
}

export function shouldLoadChatGPTStorageState(
  flowId: CliFlowCommandId,
): boolean {
  return (
    flowId === 'chatgpt-login' ||
    flowId === 'chatgpt-team-trial' ||
    flowId === 'chatgpt-login-invite'
  )
}

export function flowCommandToId(command: string): CliFlowCommandId | undefined {
  const normalized = command.trim()
  if (!normalized.startsWith('flow:')) {
    return undefined
  }

  const flowId = normalized.slice('flow:'.length)
  if (
    flowId === 'chatgpt-register' ||
    flowId === 'chatgpt-login' ||
    flowId === 'chatgpt-team-trial' ||
    flowId === 'chatgpt-login-invite' ||
    flowId === 'codex-oauth' ||
    flowId === 'noop'
  ) {
    return flowId
  }

  return undefined
}

export async function prepareFlowStorageState(input: {
  flowId: CliFlowCommandId
  options: FlowOptions
}): Promise<PreparedFlowStorageState> {
  if (!shouldLoadChatGPTStorageState(input.flowId)) {
    return {
      options: input.options,
    }
  }

  const stored = await resolveStoredChatGPTIdentity({
    id: input.options.identityId,
    email: input.options.email,
  })
  const storageState = resolveLocalChatGPTStorageState({
    identityId: stored.summary.id,
    email: stored.summary.email,
  })

  return {
    options: {
      ...input.options,
      identityId: stored.summary.id,
      email: stored.summary.email,
    },
    storedIdentity: stored.summary,
    storageState,
  }
}
