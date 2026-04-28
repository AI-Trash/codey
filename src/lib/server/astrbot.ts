import '@tanstack/react-start/server-only'

import {
  getAstrBotPayPalNotificationConfig,
  type AstrBotPayPalNotificationConfig,
} from './external-service-configs'
import type { AdminManagedWorkspaceSummary } from './workspaces'

export interface AstrBotPayPalNotificationInput {
  paypalUrl: string
  workspace?: AdminManagedWorkspaceSummary | null
  capturedAt?: Date
}

export interface AstrBotPayPalNotificationResult {
  endpoint: string
  umo: string
}

function buildEndpoint(config: AstrBotPayPalNotificationConfig): string {
  return `${config.baseUrl}${config.messagePath}`
}

function applyTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    return values[key] ?? match
  })
}

function buildPayPalNotificationMessage(
  input: AstrBotPayPalNotificationInput,
  template?: string,
): string {
  const workspaceLabel =
    input.workspace?.label ||
    input.workspace?.workspaceId ||
    input.workspace?.id ||
    'unknown workspace'
  const ownerEmail = input.workspace?.owner?.email || 'unknown owner'
  const capturedAt = (input.capturedAt || new Date()).toISOString()
  const expiresAt = input.workspace?.teamTrialPaypalExpiresAt || ''
  const values = {
    paypalUrl: input.paypalUrl,
    workspaceLabel,
    workspaceId: input.workspace?.workspaceId || '',
    workspaceRecordId: input.workspace?.id || '',
    ownerEmail,
    capturedAt,
    expiresAt,
  }

  if (template) {
    return applyTemplate(template, values)
  }

  return [
    'Codey captured a ChatGPT Team trial PayPal payment link.',
    `Workspace: ${workspaceLabel}`,
    `Owner: ${ownerEmail}`,
    expiresAt ? `Expires at: ${expiresAt}` : 'Expires in: 10 minutes',
    `PayPal: ${input.paypalUrl}`,
  ].join('\n')
}

async function readResponseBody(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return JSON.stringify(await response.json())
    } catch {
      return ''
    }
  }

  try {
    return await response.text()
  } catch {
    return ''
  }
}

export async function sendAstrBotPayPalNotification(
  input: AstrBotPayPalNotificationInput,
): Promise<AstrBotPayPalNotificationResult | null> {
  const config = await getAstrBotPayPalNotificationConfig()
  if (!config) {
    return null
  }

  if (!config.apiKey && !config.bearerToken) {
    throw new Error(
      'AstrBot API key or bearer token is required in External services before PayPal notifications can be sent.',
    )
  }

  const endpoint = buildEndpoint(config)
  const controller = new AbortController()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey
  } else if (config.bearerToken) {
    headers.Authorization = `Bearer ${config.bearerToken}`
  }

  const timeout = setTimeout(() => {
    controller.abort()
  }, config.timeoutMs)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        umo: config.umo,
        message: buildPayPalNotificationMessage(input, config.messageTemplate),
      }),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `AstrBot PayPal notification timed out after ${config.timeoutMs}ms.`,
      )
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const responseBody = await readResponseBody(response)
    throw new Error(
      `AstrBot PayPal notification failed with HTTP ${response.status}${
        responseBody ? `: ${responseBody.slice(0, 500)}` : ''
      }`,
    )
  }

  return {
    endpoint,
    umo: config.umo,
  }
}
