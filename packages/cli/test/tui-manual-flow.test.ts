import { describe, expect, it } from 'vitest'

import {
  buildManualFlowChoices,
  buildManualFlowOptionChoices,
  describeManualFlow,
  normalizeManualFlowAnswers,
} from '../src/modules/tui/manual-flow'

describe('tui manual flow helpers', () => {
  it('builds local flow choices with readable descriptions', () => {
    const choices = buildManualFlowChoices()
    const codexOauth = choices.find((entry) => entry.name === 'codex-oauth')

    expect(codexOauth).toMatchObject({
      name: 'codex-oauth',
      message: 'codex-oauth',
    })
    expect(describeManualFlow('chatgpt-login')).toContain('shared ChatGPT')
  })

  it('includes both common and flow-specific options for local start', () => {
    const choices = buildManualFlowOptionChoices('chatgpt-login-invite')

    expect(choices.some((entry) => entry.name === 'record')).toBe(true)
    expect(choices.some((entry) => entry.name === 'inviteEmail')).toBe(true)
  })

  it('normalizes prompt answers into flow options', () => {
    const options = normalizeManualFlowAnswers('chatgpt-login-invite', {
      record: false,
      slowMo: '250',
      inviteEmail: 'a@example.com,\nb@example.com',
      email: 'person@example.com',
    })

    expect(options).toEqual({
      record: false,
      slowMo: 250,
      inviteEmail: ['a@example.com', 'b@example.com'],
      email: 'person@example.com',
    })
  })
})
