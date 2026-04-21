import { sanitizeErrorForOutput } from '../flow-cli/helpers'
import type { CliNotificationsAuthState } from './device-login'
import { resolveAppUrl } from './http'
import { ensureJson } from './http'

export interface CliConnectionRuntimeState {
  runtimeFlowId?: string | null
  runtimeTaskId?: string | null
  runtimeFlowStatus?: string | null
  runtimeFlowMessage?: string | null
  runtimeFlowStartedAt?: string | null
  runtimeFlowCompletedAt?: string | null
}

async function postCliConnectionRuntimeState(input: {
  connectionId: string
  authState: CliNotificationsAuthState
  state: CliConnectionRuntimeState
}): Promise<void> {
  const response = await fetch(
    resolveAppUrl(
      `/api/cli/connections/${encodeURIComponent(input.connectionId)}/status`,
    ),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${input.authState.accessToken}`,
      },
      body: JSON.stringify(input.state),
    },
  )

  await ensureJson<{ ok: boolean }>(response)
}

export class CliConnectionRuntimeReporter {
  private connectionId?: string
  private readonly authState: CliNotificationsAuthState
  private readonly onError?: (error: Error) => void
  private pendingState?: CliConnectionRuntimeState
  private inFlight = false
  private lastSerializedState?: string
  private flushResolvers: Array<() => void> = []

  constructor(input: {
    authState: CliNotificationsAuthState
    onError?: (error: Error) => void
  }) {
    this.authState = input.authState
    this.onError = input.onError
  }

  setConnectionId(connectionId: string | undefined): void {
    this.connectionId = connectionId
    void this.drain()
  }

  update(state: CliConnectionRuntimeState): void {
    this.pendingState = state
    void this.drain()
  }

  async flush(): Promise<void> {
    if (!this.connectionId) {
      return
    }

    if (!this.pendingState && !this.inFlight) {
      return
    }

    await new Promise<void>((resolve) => {
      this.flushResolvers.push(resolve)
      void this.drain()
    })
  }

  private resolveFlushes(): void {
    if (this.pendingState || this.inFlight) {
      return
    }

    for (const resolve of this.flushResolvers.splice(0)) {
      resolve()
    }
  }

  private async drain(): Promise<void> {
    if (!this.connectionId || this.inFlight || !this.pendingState) {
      this.resolveFlushes()
      return
    }

    const nextState = this.pendingState
    this.pendingState = undefined
    const serializedState = JSON.stringify(nextState)

    if (serializedState === this.lastSerializedState) {
      this.resolveFlushes()
      return
    }

    this.inFlight = true

    try {
      await postCliConnectionRuntimeState({
        connectionId: this.connectionId,
        authState: this.authState,
        state: nextState,
      })
      this.lastSerializedState = serializedState
    } catch (error) {
      const sanitized = sanitizeErrorForOutput(error)
      this.onError?.(sanitized)
    } finally {
      this.inFlight = false
      if (this.pendingState) {
        void this.drain()
      } else {
        this.resolveFlushes()
      }
    }
  }
}
