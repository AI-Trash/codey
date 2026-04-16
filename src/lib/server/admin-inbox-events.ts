import '@tanstack/react-start/server-only'

import type { AdminInboxEmail } from './verification'

type AdminInboxEmailListener = (email: AdminInboxEmail) => void

type AdminInboxEventState = {
  listeners: Set<AdminInboxEmailListener>
}

const ADMIN_INBOX_EVENT_STATE_KEY = Symbol.for('codey.admin-inbox-events')

function getAdminInboxEventState(): AdminInboxEventState {
  const globalState = globalThis as typeof globalThis & {
    [ADMIN_INBOX_EVENT_STATE_KEY]?: AdminInboxEventState
  }

  if (!globalState[ADMIN_INBOX_EVENT_STATE_KEY]) {
    globalState[ADMIN_INBOX_EVENT_STATE_KEY] = {
      listeners: new Set<AdminInboxEmailListener>(),
    }
  }

  return globalState[ADMIN_INBOX_EVENT_STATE_KEY]
}

export function publishAdminInboxEmailEvent(email: AdminInboxEmail) {
  for (const listener of getAdminInboxEventState().listeners) {
    try {
      listener(email)
    } catch (error) {
      console.error('Failed to publish admin inbox email event', error)
    }
  }
}

export function hasAdminInboxEmailSubscribers() {
  return getAdminInboxEventState().listeners.size > 0
}

export function subscribeAdminInboxEmailEvents(
  listener: AdminInboxEmailListener,
) {
  const state = getAdminInboxEventState()
  state.listeners.add(listener)

  return () => {
    state.listeners.delete(listener)
  }
}
