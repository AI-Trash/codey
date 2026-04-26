import {
  normalizeCliFlowCommandId,
  type CliFlowCommandId,
} from './flow-registry'
import { parseBooleanFlag, type FlowOptions } from './helpers'
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
    flowId === 'chatgpt-invite'
  )
}

export function flowCommandToId(command: string): CliFlowCommandId | undefined {
  const normalized = command.trim()
  if (!normalized.startsWith('flow:')) {
    return undefined
  }

  return normalizeCliFlowCommandId(normalized.slice('flow:'.length))
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
  const restoreStorageState =
    parseBooleanFlag(input.options.restoreStorageState, false) ?? false
  const storageState = restoreStorageState
    ? resolveLocalChatGPTStorageState({
        identityId: stored.summary.id,
        email: stored.summary.email,
      })
    : undefined

  return {
    options: {
      ...input.options,
      identityId: stored.summary.id,
      email: stored.summary.email,
      restoreStorageState,
      chatgptStorageStatePath: storageState?.storageStatePath,
      chatgptStorageStateIdentityId: storageState?.identityId,
      chatgptStorageStateEmail: storageState?.email,
    },
    storedIdentity: stored.summary,
    storageState,
  }
}
