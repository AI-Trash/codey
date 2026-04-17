import type { Page } from 'patchright'
import { describe, expect, it, vi } from 'vitest'
import { createAuthorizationCallbackCapture } from '../src/modules/authorization/codex-authorization'

type RouteHandler = (route: {
  request: () => { url: () => string }
  fulfill: (response: {
    status: number
    contentType: string
    body: string
  }) => Promise<void>
}) => Promise<void>

function createFakePage() {
  let matcher: RegExp | undefined
  let handler: RouteHandler | undefined

  const route = vi.fn(
    async (nextMatcher: RegExp, nextHandler: RouteHandler) => {
      matcher = nextMatcher
      handler = nextHandler
    },
  )
  const unroute = vi.fn(async () => {})

  return {
    page: {
      route,
      unroute,
    } as unknown as Page,
    route,
    unroute,
    getMatcher: () => matcher,
    getHandler: () => handler,
  }
}

describe('createAuthorizationCallbackCapture', () => {
  it('captures callback params from a routed browser navigation', async () => {
    const fakePage = createFakePage()
    const capture = await createAuthorizationCallbackCapture(fakePage.page, {
      host: '127.0.0.1',
      port: 3000,
      path: '/callback',
    })

    const fulfill = vi.fn(async () => {})
    const handler = fakePage.getHandler()

    expect(
      fakePage
        .getMatcher()
        ?.test(
          'http://127.0.0.1:3000/callback?code=test-code&state=test-state',
        ),
    ).toBe(true)
    expect(handler).toBeTypeOf('function')

    await handler!({
      request: () => ({
        url: () =>
          'http://127.0.0.1:3000/callback?code=test-code&state=test-state&scope=openid',
      }),
      fulfill,
    })

    await expect(capture.result).resolves.toEqual({
      code: 'test-code',
      state: 'test-state',
      scope: 'openid',
      rawQuery: '/callback?code=test-code&state=test-state&scope=openid',
      callbackUrl:
        'http://127.0.0.1:3000/callback?code=test-code&state=test-state&scope=openid',
    })
    expect(fulfill).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: expect.stringContaining('Authorization received'),
      }),
    )
    expect(fakePage.unroute).toHaveBeenCalled()
  })

  it('rejects and cleans up when the callback capture is aborted', async () => {
    const fakePage = createFakePage()
    const capture = await createAuthorizationCallbackCapture(fakePage.page)

    await capture.abort()

    await expect(capture.result).rejects.toThrow(
      'Authorization callback wait aborted.',
    )
    expect(fakePage.unroute).toHaveBeenCalled()
  })
})
