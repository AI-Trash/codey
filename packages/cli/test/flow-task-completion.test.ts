import { describe, expect, it } from 'vitest'

import { assertFlowTaskExecutionSucceeded } from '../src/modules/flow-cli/task-completion'

describe('flow task completion assertions', () => {
  it('accepts chatgpt-register results with a stored identity summary', () => {
    expect(() =>
      assertFlowTaskExecutionSucceeded('chatgpt-register', {
        status: 'passed',
        result: {
          storedIdentity: {
            id: 'identity-1',
            email: 'person@example.com',
          },
        },
      }),
    ).not.toThrow()
  })

  it('rejects chatgpt-register results that do not persist an identity', () => {
    expect(() =>
      assertFlowTaskExecutionSucceeded('chatgpt-register', {
        status: 'passed',
        result: {},
      }),
    ).toThrow(/shared identity/i)
  })

  it('leaves non-registration flows unchanged', () => {
    expect(() =>
      assertFlowTaskExecutionSucceeded('chatgpt-login', {
        status: 'passed',
        result: undefined,
      }),
    ).not.toThrow()
  })
})
