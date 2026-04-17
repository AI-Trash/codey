export type VerificationProviderKind = 'exchange' | 'app'

export interface VerificationEmailTarget {
  email: string
  prefix?: string
  mailbox?: string
}

export interface WaitForVerificationCodeOptions {
  email: string
  startedAt: string
  timeoutMs: number
  pollIntervalMs: number
  onPollAttempt?: (attempt: number) => void | Promise<void>
}

export interface VerificationCodeStreamEvent {
  reservationId?: string
  email?: string
  code?: string
  source?: string
  receivedAt?: string
  cursor?: string
}

export interface VerificationProvider {
  readonly kind: VerificationProviderKind
  prepareEmailTarget():
    | Promise<VerificationEmailTarget>
    | VerificationEmailTarget
  primeInbox(): Promise<void>
  waitForVerificationCode(
    options: WaitForVerificationCodeOptions,
  ): Promise<string>
  streamVerificationEvents?(params: {
    email: string
    startedAt: string
    signal?: AbortSignal
  }): AsyncGenerator<VerificationCodeStreamEvent, void, void>
}
