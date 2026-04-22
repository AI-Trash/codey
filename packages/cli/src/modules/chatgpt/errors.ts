export class ChatGPTAccountDeactivatedError extends Error {
  readonly code = 'account_deactivated'

  constructor(
    message = 'ChatGPT account was deactivated by OpenAI (account_deactivated).',
  ) {
    super(message)
    this.name = 'ChatGPTAccountDeactivatedError'
  }
}

export function isChatGPTAccountDeactivatedError(
  error: unknown,
): error is ChatGPTAccountDeactivatedError {
  return error instanceof ChatGPTAccountDeactivatedError
}
