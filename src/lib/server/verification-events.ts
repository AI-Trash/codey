import '@tanstack/react-start/server-only'

import type { VerificationCodeEvent } from './verification'

type VerificationCodeEventListener = (event: VerificationCodeEvent) => void

type VerificationEventState = {
  listeners: Set<VerificationCodeEventListener>
}

const VERIFICATION_EVENT_STATE_KEY = Symbol.for('codey.verification-events')

function getVerificationEventState(): VerificationEventState {
  const globalState = globalThis as typeof globalThis & {
    [VERIFICATION_EVENT_STATE_KEY]?: VerificationEventState
  }

  if (!globalState[VERIFICATION_EVENT_STATE_KEY]) {
    globalState[VERIFICATION_EVENT_STATE_KEY] = {
      listeners: new Set<VerificationCodeEventListener>(),
    }
  }

  return globalState[VERIFICATION_EVENT_STATE_KEY]
}

export function publishVerificationCodeEvent(event: VerificationCodeEvent) {
  for (const listener of getVerificationEventState().listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('Failed to publish verification code event', error)
    }
  }
}

export function subscribeVerificationCodeEvents(
  listener: VerificationCodeEventListener,
) {
  const state = getVerificationEventState()
  state.listeners.add(listener)

  return () => {
    state.listeners.delete(listener)
  }
}
