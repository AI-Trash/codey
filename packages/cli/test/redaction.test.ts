import { describe, expect, it } from 'vitest'

import { redactForOutput } from '../src/utils/redaction'

describe('redaction', () => {
  it('redacts cyclic values without overflowing the stack', () => {
    const value: Record<string, unknown> = {
      apiKey: 'sk-test',
      url: 'https://example.com/path?token=secret#fragment',
    }
    value.self = value
    value.children = [value]

    const redacted = redactForOutput(value) as Record<string, unknown>

    expect(redacted).toMatchObject({
      apiKey: '***redacted***',
      url: 'https://example.com/path',
      self: '[Circular]',
    })
    expect((redacted.children as unknown[])[0]).toBe('[Circular]')
    expect(() => JSON.stringify(redacted)).not.toThrow()
  })

  it('does not treat repeated non-cyclic references as circular', () => {
    const shared = {
      refreshToken: 'refresh-test',
    }
    const redacted = redactForOutput({
      left: shared,
      right: shared,
    }) as Record<string, Record<string, unknown>>

    expect(redacted.left).toEqual({
      refreshToken: '***redacted***',
    })
    expect(redacted.right).toEqual({
      refreshToken: '***redacted***',
    })
  })

  it('truncates overly deep values', () => {
    let value: Record<string, unknown> = { leaf: 'done' }
    for (let index = 0; index < 60; index += 1) {
      value = {
        index,
        next: value,
      }
    }

    const redacted = redactForOutput(value)
    const serialized = JSON.stringify(redacted)

    expect(serialized).toContain('[MaxDepth:50]')
    expect(() => JSON.stringify(redacted)).not.toThrow()
  })
})
