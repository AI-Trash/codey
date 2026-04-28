import { describe, expect, it, vi } from 'vitest'
import { createChatGPTSessionCapture } from '../src/modules/chatgpt/session'

type EventHandler = (payload: unknown) => void

function createRequest(input: {
  url?: string
  postData?: string
  headers?: Record<string, string>
}) {
  return {
    url: () => input.url || 'https://chatgpt.com/api/auth/session',
    postData: () => input.postData || '',
    headers: () => input.headers || {},
  }
}

function createResponse(input: {
  url?: string
  body: Record<string, unknown>
  request?: ReturnType<typeof createRequest>
}) {
  return {
    url: () => input.url || 'https://chatgpt.com/api/auth/session',
    headers: () => ({
      'content-type': 'application/json',
    }),
    text: async () => JSON.stringify(input.body),
    request: () => input.request || createRequest({}),
  }
}

function createPage(input?: {
  pageStorage?: unknown
  storageState?: unknown
  content?: string
}) {
  const handlers = new Map<string, Set<EventHandler>>()
  const on = vi.fn((eventName: string, handler: EventHandler) => {
    const eventHandlers = handlers.get(eventName) || new Set<EventHandler>()
    eventHandlers.add(handler)
    handlers.set(eventName, eventHandlers)
  })
  const off = vi.fn((eventName: string, handler: EventHandler) => {
    handlers.get(eventName)?.delete(handler)
  })

  return {
    on,
    off,
    url: () => 'https://chatgpt.com/',
    content: vi.fn(async () => input?.content || ''),
    evaluate: vi.fn(async () => input?.pageStorage || {}),
    context: () => ({
      cookies: vi.fn(async () => []),
      storageState: vi.fn(async () => input?.storageState || { origins: [] }),
    }),
    emit(eventName: string, payload: unknown) {
      for (const handler of handlers.get(eventName) || []) {
        handler(payload)
      }
    },
  }
}

describe('createChatGPTSessionCapture', () => {
  it('captures camelCase refresh tokens from readable session responses', async () => {
    const page = createPage()
    const capture = createChatGPTSessionCapture(page as never)

    page.emit(
      'response',
      createResponse({
        body: {
          clientId: 'chatgpt-client',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        },
      }),
    )

    const snapshots = await capture.capture()

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.clientId).toBe('chatgpt-client')
    expect(snapshots[0]?.auth.tokens).toMatchObject({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      id_token: 'id-token',
    })
    expect(snapshots[0]?.hasRefreshToken).toBe(true)
  })

  it('captures refresh tokens from readable browser storage snapshots', async () => {
    const page = createPage({
      pageStorage: {
        localStorage: [
          [
            'chatgpt-auth',
            JSON.stringify({
              clientId: 'storage-client',
              tokens: {
                accessToken: 'storage-access-token',
                refreshToken: 'storage-refresh-token',
              },
            }),
          ],
        ],
        sessionStorage: [],
      },
    })
    const capture = createChatGPTSessionCapture(page as never)

    const snapshots = await capture.capture()

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.clientId).toBe('storage-client')
    expect(snapshots[0]?.auth.tokens).toMatchObject({
      access_token: 'storage-access-token',
      refresh_token: 'storage-refresh-token',
    })
    expect(snapshots[0]?.hasRefreshToken).toBe(true)
  })
})
