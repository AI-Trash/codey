import { describe, expect, it } from 'vitest'

import { isRecoverableBrowserAutomationError } from '../src/utils/browser-errors'

describe('browser automation error classification', () => {
  it('treats stale Chromium execution contexts as recoverable automation errors', () => {
    const error = new Error(
      'Protocol error (DOM.describeNode): Cannot find context with specified id',
    )

    expect(isRecoverableBrowserAutomationError(error)).toBe(true)
  })

  it('treats abort cleanup rejections as recoverable automation errors', () => {
    const error = new DOMException('This operation was aborted', 'AbortError')

    expect(isRecoverableBrowserAutomationError(error)).toBe(true)
  })

  it('does not hide unrelated programming errors', () => {
    expect(
      isRecoverableBrowserAutomationError(new TypeError('x is null')),
    ).toBe(false)
  })
})
