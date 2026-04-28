export class ChatGPTAccountDeactivatedError extends Error {
  readonly code = 'account_deactivated'

  constructor(
    message = 'ChatGPT account was deactivated by OpenAI (account_deactivated).',
  ) {
    super(message)
    this.name = 'ChatGPTAccountDeactivatedError'
  }
}

export class OpenAIBrowserChallengeError extends Error {
  readonly code = 'openai_browser_challenge'

  constructor(
    message = 'OpenAI served a browser verification interstitial instead of a supported ChatGPT login surface.',
  ) {
    super(message)
    this.name = 'OpenAIBrowserChallengeError'
  }
}

export function isChatGPTAccountDeactivatedError(
  error: unknown,
  seen = new Set<unknown>(),
): boolean {
  if (error instanceof ChatGPTAccountDeactivatedError) {
    return true
  }

  if (typeof error === 'string') {
    return /account_deactivated/i.test(error)
  }

  if (!error || typeof error !== 'object' || seen.has(error)) {
    return false
  }

  seen.add(error)

  if (error instanceof Error && /account_deactivated/i.test(error.message)) {
    return true
  }

  return isChatGPTAccountDeactivatedError(
    (error as { cause?: unknown }).cause,
    seen,
  )
}
