import {
  sanitizeErrorForOutput,
  type FlowProgressReporter,
} from '../flow-cli/helpers'
import { syncManagedIdentityToCodeyApp } from '../app-auth/managed-identities'
import { isChatGPTAccountDeactivatedError } from './errors'

export interface ChatGPTAccountDeactivationIdentity {
  id: string
  email: string
  credentialCount?: number
}

export async function reportChatGPTAccountDeactivationToCodeyApp(input: {
  error: unknown
  identity?: ChatGPTAccountDeactivationIdentity | null
  progressReporter?: FlowProgressReporter
}): Promise<boolean> {
  if (!isChatGPTAccountDeactivatedError(input.error) || !input.identity) {
    return false
  }

  const identity = input.identity

  try {
    const reported = await syncManagedIdentityToCodeyApp({
      identityId: identity.id,
      email: identity.email,
      credentialCount: identity.credentialCount,
      status: 'BANNED',
    })
    input.progressReporter?.({
      message: reported
        ? `OpenAI returned account_deactivated; marked ${identity.email} as banned in Codey app`
        : `OpenAI returned account_deactivated for ${identity.email}, but Codey app access was unavailable to report the banned status`,
    })
  } catch (reportError) {
    input.progressReporter?.({
      message: `OpenAI returned account_deactivated for ${identity.email}, but reporting the banned status to Codey app failed: ${sanitizeErrorForOutput(reportError).message}`,
    })
  }

  return true
}
