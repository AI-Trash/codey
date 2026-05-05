import '@tanstack/react-start/server-only'

import type { AdminVerificationMessage } from './verification'

type AdminVerificationMessageListener = (
  message: AdminVerificationMessage,
) => void

type AdminInboxEventState = {
  listeners: Set<AdminVerificationMessageListener>
}

const ADMIN_INBOX_EVENT_STATE_KEY = Symbol.for('codey.admin-inbox-events')

function getAdminInboxEventState(): AdminInboxEventState {
  const globalState = globalThis as typeof globalThis & {
    [ADMIN_INBOX_EVENT_STATE_KEY]?: AdminInboxEventState
  }

  if (!globalState[ADMIN_INBOX_EVENT_STATE_KEY]) {
    globalState[ADMIN_INBOX_EVENT_STATE_KEY] = {
      listeners: new Set<AdminVerificationMessageListener>(),
    }
  }

  return globalState[ADMIN_INBOX_EVENT_STATE_KEY]
}

export function publishAdminVerificationMessageEvent(
  message: AdminVerificationMessage,
) {
  for (const listener of getAdminInboxEventState().listeners) {
    try {
      listener(message)
    } catch (error) {
      console.error('Failed to publish admin verification message event', error)
    }
  }
}

export function hasAdminVerificationMessageSubscribers() {
  return getAdminInboxEventState().listeners.size > 0
}

export function subscribeAdminVerificationMessageEvents(
  listener: AdminVerificationMessageListener,
) {
  const state = getAdminInboxEventState()
  state.listeners.add(listener)

  return () => {
    state.listeners.delete(listener)
  }
}
