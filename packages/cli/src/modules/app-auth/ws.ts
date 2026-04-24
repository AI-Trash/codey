export interface WsEvent<TEvent extends string = string> {
  event: TEvent
  data: Record<string, unknown>
  id?: string
}

export function toWebSocketUrl(url: URL): URL {
  const wsUrl = new URL(url)
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return wsUrl
}

export async function connectWebSocket(input: {
  url: URL | string
  headers?: Record<string, string>
}): Promise<WebSocket> {
  const socket = new WebSocket(input.url, {
    headers: input.headers,
  })

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('error', onError)
    }
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('WebSocket connection failed.'))
    }
    socket.addEventListener('open', onOpen)
    socket.addEventListener('error', onError)
  })

  return socket
}

export async function* streamWebSocketEvents<TEvent extends string = string>(input: {
  url: URL | string
  socket?: WebSocket
  headers?: Record<string, string>
  signal?: AbortSignal
  onReady?: (socket: WebSocket) => void
}): AsyncGenerator<WsEvent<TEvent>, void, void> {
  const socket =
    input.socket || (await connectWebSocket({ url: input.url, headers: input.headers }))
  const queue: WsEvent<TEvent>[] = []
  let waiting:
    | ((value: IteratorResult<WsEvent<TEvent>, void>) => void)
    | undefined
  let pendingError: Error | undefined
  let closed = false

  const ownsSocket = !input.socket
  const closeSocket = () => {
    if (closed) {
      return
    }
    closed = true
    if (ownsSocket) {
      socket.close()
    }
  }

  input.signal?.addEventListener('abort', closeSocket, { once: true })

  socket.addEventListener('message', (rawEvent) => {
    try {
      const envelope = JSON.parse(String(rawEvent.data)) as WsEvent<TEvent>
      if (waiting) {
        const resolve = waiting
        waiting = undefined
        resolve({ done: false, value: envelope })
      } else {
        queue.push(envelope)
      }
    } catch (error) {
      pendingError = error instanceof Error ? error : new Error(String(error))
      if (waiting) {
        const resolve = waiting
        waiting = undefined
        resolve({ done: true, value: undefined })
      }
      closeSocket()
    }
  })

  socket.addEventListener('error', () => {
    pendingError = new Error('WebSocket connection failed.')
    if (waiting) {
      const resolve = waiting
      waiting = undefined
      resolve({ done: true, value: undefined })
    }
    closeSocket()
  })

  socket.addEventListener('close', () => {
    closed = true
    if (waiting) {
      const resolve = waiting
      waiting = undefined
      resolve({ done: true, value: undefined })
    }
  })

  input.onReady?.(socket)

  try {
    while (true) {
      if (pendingError) {
        throw pendingError
      }

      const next = queue.shift()
      if (next) {
        yield next
        continue
      }

      if (closed) {
        break
      }

      const result = await new Promise<IteratorResult<WsEvent<TEvent>, void>>(
        (resolve) => {
          waiting = resolve
        },
      )
      if (result.done) {
        break
      }
      yield result.value
    }
  } finally {
    closeSocket()
  }
}
