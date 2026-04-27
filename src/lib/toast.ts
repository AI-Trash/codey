import { toast } from 'sonner'

import { m } from '#/paraglide/messages'

export type AppToast = {
  kind: 'success' | 'error'
  title?: string
  description?: string | null
}

export function showAppToast(message: AppToast) {
  const title =
    message.title ||
    (message.kind === 'error' ? m.status_failed() : m.status_success())
  const options = message.description
    ? { description: message.description }
    : undefined

  if (message.kind === 'error') {
    toast.error(title, options)
    return
  }

  toast.success(title, options)
}

export function getToastErrorDescription(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
