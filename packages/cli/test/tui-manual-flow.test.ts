import { describe, expect, it } from 'vitest'

import {
  buildManualFlowChoices,
  buildManualFlowOptionChoices,
  describeManualFlow,
  normalizeManualFlowAnswers,
  normalizeManualFlowParallelism,
  normalizeManualFlowRepeatCount,
  supportsManualFlowBatching,
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

  it('limits manual repeat counts and defaults to one when missing', () => {
    expect(normalizeManualFlowRepeatCount('')).toBe(1)
    expect(normalizeManualFlowRepeatCount('3')).toBe(3)
    expect(normalizeManualFlowRepeatCount('99')).toBe(20)
  })

  it('limits manual parallelism to the task count and default range', () => {
    expect(normalizeManualFlowParallelism('', 3)).toBe(1)
    expect(normalizeManualFlowParallelism('3', 3)).toBe(3)
    expect(normalizeManualFlowParallelism('9', 3)).toBe(3)
  })

  it('only enables local batching for registration flows', () => {
    expect(supportsManualFlowBatching('chatgpt-register')).toBe(true)
    expect(supportsManualFlowBatching('chatgpt-login')).toBe(false)
  })
})
