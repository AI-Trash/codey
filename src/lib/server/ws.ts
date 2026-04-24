import '@tanstack/react-start/server-only'

export interface WsEnvelope<T extends string = string, D = Record<string, unknown>> {
  event: T
  data: D
  id?: string
}

export function toWsMessage<T extends string, D>(payload: WsEnvelope<T, D>) {
  return JSON.stringify(payload)
}

