import { createFileRoute } from '@tanstack/react-router'

import { json, text } from '../../../lib/server/http'
import { VERIFICATION_INGEST_SCOPE } from '../../../lib/server/oauth-scopes'
import { authorizeVerificationAccess } from '../../../lib/server/request'
import { ingestWhatsAppNotification } from '../../../lib/server/verification'

interface WhatsAppNotificationIngestPayload {
  reservationId?: string
  email?: string
  targetEmail?: string
  reservationEmail?: string
  deviceId?: string
  notificationId?: string
  packageName?: string
  sender?: string
  senderPhone?: string
  chatName?: string
  title?: string
  notificationTitle?: string
  body?: string
  text?: string
  message?: string
  rawPayload?: Record<string, unknown>
  extractedCode?: string
  receivedAt?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRawPayload(payload: WhatsAppNotificationIngestPayload) {
  return isObject(payload.rawPayload) ? payload.rawPayload : { ...payload }
}

export const Route = createFileRoute('/api/ingest/whatsapp-notification')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = await authorizeVerificationAccess(request, [
          VERIFICATION_INGEST_SCOPE,
        ])
        if (authResult instanceof Response) return authResult

        let payload: unknown
        try {
          payload = await request.json()
        } catch {
          return text('Invalid JSON body', 400)
        }

        if (!isObject(payload)) {
          return text('JSON body must be an object', 400)
        }

        const body = payload as WhatsAppNotificationIngestPayload
        const result = await ingestWhatsAppNotification({
          reservationId: body.reservationId,
          email: body.email || body.targetEmail || body.reservationEmail,
          deviceId: body.deviceId,
          notificationId: body.notificationId,
          packageName: body.packageName,
          sender: body.sender || body.senderPhone,
          chatName: body.chatName,
          title: body.title || body.notificationTitle,
          body: body.body || body.text || body.message,
          rawPayload: getRawPayload(body),
          extractedCode: body.extractedCode,
          receivedAt: body.receivedAt,
        })

        return json({
          ok: true,
          notificationRecordId: result.notificationRecord.id,
          codeRecordId: result.codeRecord?.id,
          match: result.match,
        })
      },
    },
  },
})
