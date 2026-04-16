export interface SseEvent {
  id?: string
  event?: string
  data: string
}

function parseSseChunk(buffer: string): {
  events: SseEvent[]
  remainder: string
} {
  const segments = buffer.split(/\r?\n\r?\n/)
  const remainder = segments.pop() || ''
  const events = segments
    .map((segment) => {
      const lines = segment.split(/\r?\n/)
      let id: string | undefined
      let event: string | undefined
      const data: string[] = []

      for (const line of lines) {
        if (!line || line.startsWith(':')) continue
        const separatorIndex = line.indexOf(':')
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line
        const rawValue =
          separatorIndex >= 0 ? line.slice(separatorIndex + 1).trimStart() : ''
        if (field === 'id') id = rawValue
        if (field === 'event') event = rawValue
        if (field === 'data') data.push(rawValue)
      }

      return {
        id,
        event,
        data: data.join('\n'),
      }
    })
    .filter((event) => event.data || event.event || event.id)

  return { events, remainder }
}

export async function* streamSse(
  response: Response,
): AsyncGenerator<SseEvent, void, void> {
  if (!response.body) {
    throw new Error('Expected streaming response body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseChunk(buffer)
    buffer = parsed.remainder
    for (const event of parsed.events) {
      yield event
    }
  }

  buffer += decoder.decode()
  const parsed = parseSseChunk(buffer)
  for (const event of parsed.events) {
    yield event
  }
}
