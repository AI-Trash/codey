import { describe, expect, it, vi } from 'vitest'
import { createChatGPTBackendMeSessionProbe } from '../src/modules/chatgpt/queries'

class FakeRequest {
  constructor(
    private readonly requestUrl: string,
    private readonly requestHeaders: Record<string, string>,
  ) {}

  url(): string {
    return this.requestUrl
  }

  headers(): Record<string, string> {
    return this.requestHeaders
  }
}

class FakePage {
  readonly requestHandlers = new Set<(request: FakeRequest) => void>()
  readonly fetchCalls: Array<{
    url: string
    requestHeaders: Record<string, string>
  }> = []
  responses: Array<{
    ok: boolean
    status: number
    url: string
    text: string
  }> = []

  on(event: 'request', handler: (request: FakeRequest) => void): void {
    if (event === 'request') {
      this.requestHandlers.add(handler)
    }
  }

  off(event: 'request', handler: (request: FakeRequest) => void): void {
    if (event === 'request') {
      this.requestHandlers.delete(handler)
    }
  }

  emitRequest(url: string, headers: Record<string, string>): void {
    const request = new FakeRequest(url, headers)
    for (const handler of this.requestHandlers) {
      handler(request)
    }
  }

  context(): {
    cookies: () => Promise<Array<{ name: string; value: string }>>
  } {
    return {
      cookies: async () => [
        {
          name: '_account',
          value: 'account-cookie',
        },
      ],
    }
  }

  async evaluate(
    _fn: unknown,
    input: {
      url: string
      requestHeaders: Record<string, string>
    },
  ): Promise<{
    ok: boolean
    status: number
    url: string
    text: string
  }> {
    this.fetchCalls.push(input)
    return (
      this.responses.shift() || {
        ok: false,
        status: 401,
        url: input.url,
        text: '',
      }
    )
  }
}

describe('createChatGPTBackendMeSessionProbe', () => {
  it('checks /backend-api/me with captured ChatGPT API headers', async () => {
    const page = new FakePage()
    page.responses.push({
      ok: true,
      status: 200,
      url: 'https://chatgpt.com/backend-api/me',
      text: JSON.stringify({
        user: {
          email: 'person@example.com',
        },
      }),
    })

    const probe = createChatGPTBackendMeSessionProbe(page as never, {
      expectedEmail: 'person@example.com',
    })
    page.emitRequest('https://chatgpt.com/backend-api/conversation_limit', {
      authorization: 'Bearer access-token',
      'chatgpt-account-id': 'account-request',
      'oai-device-id': 'device-123',
    })

    await expect(probe.wait(10)).resolves.toBe(true)

    expect(page.fetchCalls[0]).toMatchObject({
      url: 'https://chatgpt.com/backend-api/me',
      requestHeaders: {
        Accept: 'application/json',
        Authorization: 'Bearer access-token',
        'ChatGPT-Account-ID': 'account-request',
        'OAI-Device-Id': 'device-123',
        'X-OpenAI-Target-Path': '/backend-api/me',
        'X-OpenAI-Target-Route': '/backend-api/me',
      },
    })

    probe.dispose()
    expect(page.requestHandlers.size).toBe(0)
  })

  it('rejects a successful /backend-api/me response for a different email', async () => {
    vi.useFakeTimers()
    const page = new FakePage()
    page.responses.push({
      ok: true,
      status: 200,
      url: 'https://chatgpt.com/backend-api/me',
      text: JSON.stringify({
        user: {
          email: 'other@example.com',
        },
      }),
    })

    const probe = createChatGPTBackendMeSessionProbe(page as never, {
      expectedEmail: 'person@example.com',
    })
    page.emitRequest('https://chatgpt.com/backend-api/me', {
      authorization: 'Bearer access-token',
      'chatgpt-account-id': 'account-request',
    })

    const result = probe.wait(1)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe(false)
    probe.dispose()
    vi.useRealTimers()
  })
})
