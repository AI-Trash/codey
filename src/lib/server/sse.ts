import '@tanstack/react-start/server-only'

function encodeEvent(event: { event?: string; data: unknown; id?: string }) {
  const lines = [] as string[]
  if (event.id) lines.push(`id: ${event.id}`)
  if (event.event) lines.push(`event: ${event.event}`)
  const payload = JSON.stringify(event.data)
  for (const line of payload.split('\n')) {
    lines.push(`data: ${line}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

export function createSubscriptionSseResponse(options: {
  request?: Request
  keepaliveMs?: number
  subscribe: (handlers: {
    send: (event: { event?: string; data: unknown; id?: string }) => void
    close: () => void
  }) => Promise<(() => void) | void> | (() => void) | void
}) {
  const keepaliveMs = options.keepaliveMs ?? 15000
  let dispose = () => {}

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const signal = options.request?.signal
      let closed = false
      let cleanup: (() => void) | void

      const close = () => {
        if (closed) return
        closed = true
        if (keepalive) {
          clearInterval(keepalive)
        }
        cleanup?.()
        if (signal && abortListener) {
          signal.removeEventListener('abort', abortListener)
        }
        try {
          controller.close()
        } catch {}
      }

      const send = (event: { event?: string; data: unknown; id?: string }) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)))
        } catch (error) {
          close()
          throw error
        }
      }

      const abortListener = () => {
        close()
      }

      if (signal) {
        signal.addEventListener('abort', abortListener)
      }

      const keepalive =
        keepaliveMs > 0
          ? setInterval(() => {
              send({ event: 'keepalive', data: { ok: true } })
            }, keepaliveMs)
          : null

      dispose = close

      try {
        cleanup = await options.subscribe({ send, close })
      } catch (error) {
        close()
        throw error
      }
    },
    cancel() {
      dispose()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

export function createPollingSseResponse(options: {
  intervalMs?: number
  timeoutMs?: number
  loadEvent: () => Promise<{
    event?: string
    data: unknown
    done?: boolean
    id?: string
  } | null>
}) {
  const intervalMs = options.intervalMs ?? 2000
  const timeoutMs = options.timeoutMs ?? 60000

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      const startedAt = Date.now()
      let closed = false

      const close = () => {
        if (closed) return
        closed = true
        clearInterval(interval)
        controller.close()
      }

      const tick = async () => {
        if (closed) return
        if (Date.now() - startedAt >= timeoutMs) {
          controller.enqueue(
            encoder.encode(
              encodeEvent({ event: 'timeout', data: { status: 'timeout' } }),
            ),
          )
          close()
          return
        }

        const next = await options.loadEvent()
        if (!next) {
          controller.enqueue(
            encoder.encode(
              encodeEvent({ event: 'keepalive', data: { ok: true } }),
            ),
          )
          return
        }

        controller.enqueue(
          encoder.encode(
            encodeEvent({
              id: next.id,
              event: next.event,
              data: next.data,
            }),
          ),
        )

        if (next.done) {
          close()
        }
      }

      const interval = setInterval(() => {
        void tick()
      }, intervalMs)

      void tick()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
