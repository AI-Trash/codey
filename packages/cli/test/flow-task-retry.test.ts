import { describe, expect, it } from 'vitest'
import {
  getFlowTaskFullRetryDecision,
  OPENAI_ADD_PHONE_FULL_RETRY_MAX_ATTEMPTS,
} from '../src/modules/flow-cli/task-retry'
import { OPENAI_ADD_PHONE_ERROR_MESSAGE } from '../src/state-machine'

describe('flow task retry decisions', () => {
  it('requests a full Codex OAuth task retry when OpenAI asks for a phone number', () => {
    expect(
      getFlowTaskFullRetryDecision({
        flowId: 'codex-oauth',
        error: new Error(OPENAI_ADD_PHONE_ERROR_MESSAGE),
      }),
    ).toEqual({
      reason: 'codex-oauth:add-phone-required',
      message:
        'OpenAI requested a phone number during the Codex OAuth flow; resetting the Codey task for a full retry.',
      maxAttempts: OPENAI_ADD_PHONE_FULL_RETRY_MAX_ATTEMPTS,
    })
  })

  it('keeps the existing invite full-retry behavior for add-phone failures', () => {
    expect(
      getFlowTaskFullRetryDecision({
        flowId: 'chatgpt-invite',
        error: `redirected to https://auth.openai.com/add-phone`,
      }),
    ).toEqual({
      reason: 'chatgpt-invite:add-phone-required',
      message:
        'OpenAI requested a phone number during the ChatGPT invite flow; resetting the Codey task for a full retry.',
      maxAttempts: OPENAI_ADD_PHONE_FULL_RETRY_MAX_ATTEMPTS,
    })
  })

  it('does not retry unsupported flows or unrelated failures', () => {
    expect(
      getFlowTaskFullRetryDecision({
        flowId: 'chatgpt-login',
        error: new Error(OPENAI_ADD_PHONE_ERROR_MESSAGE),
      }),
    ).toBeUndefined()
    expect(
      getFlowTaskFullRetryDecision({
        flowId: 'codex-oauth',
        error: new Error('ChatGPT account was deactivated by OpenAI.'),
      }),
    ).toBeUndefined()
  })
})
