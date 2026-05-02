import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildWhatsAppNotificationIngestPayload,
  createWhatsAppNotificationDeduper,
  extractVerificationCodeFromNotificationText,
  normalizeSmsForwarderWhatsAppNotificationPayload,
  startWhatsAppNotificationWebhookServer,
} from '../src/modules/android/whatsapp-notifications'

const openHandles: Array<{
  stop(): Promise<void>
}> = []

afterEach(async () => {
  await Promise.all(openHandles.splice(0).map((handle) => handle.stop()))
})

function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<{
  statusCode: number
  body: Record<string, unknown>
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode || 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          })
        })
      },
    )
    request.on('error', reject)
    request.end(JSON.stringify(body))
  })
}

function postRaw(
  url: string,
  body: string,
): Promise<{
  statusCode: number
  body: Record<string, unknown>
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode || 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          })
        })
      },
    )
    request.on('error', reject)
    request.end(body)
  })
}

describe('SmsForwarder WhatsApp notification helpers', () => {
  it('normalizes SmsForwarder notification payloads', () => {
    expect(
      normalizeSmsForwarderWhatsAppNotificationPayload({
        msg_app: 'WhatsApp',
        msg_title: 'OpenAI',
        msg_content: 'Your verification code is 123456.',
        msg_time: '2026-04-30T17:50:00.000Z',
      }),
    ).toEqual({
      packageName: 'com.whatsapp',
      title: 'OpenAI',
      body: 'Your verification code is 123456.',
      rawPayload: {
        msg_app: 'WhatsApp',
        msg_title: 'OpenAI',
        msg_content: 'Your verification code is 123456.',
        msg_time: '2026-04-30T17:50:00.000Z',
      },
      receivedAt: '2026-04-30T17:50:00.000Z',
    })
  })

  it('extracts verification codes from localized notification text', () => {
    expect(
      extractVerificationCodeFromNotificationText('验证码：654321，请勿泄露'),
    ).toBe('654321')
  })

  it('builds Codey ingest payloads with reservation hints', () => {
    expect(
      buildWhatsAppNotificationIngestPayload(
        {
          packageName: 'com.whatsapp',
          notificationId: 'wa-1',
          title: 'OpenAI',
          body: 'Use code 246810 to continue.',
          receivedAt: '2026-04-30T17:51:00.000Z',
        },
        {
          reservationId: 'reservation-1',
          email: 'codey+otp@example.com',
          deviceId: 'emulator-5554',
        },
      ),
    ).toMatchObject({
      reservationId: 'reservation-1',
      email: 'codey+otp@example.com',
      deviceId: 'emulator-5554',
      notificationId: 'wa-1',
      packageName: 'com.whatsapp',
      extractedCode: '246810',
    })
  })

  it('dedupes repeated notification messages within the ttl', () => {
    const deduper = createWhatsAppNotificationDeduper(1000)
    const event = {
      packageName: 'com.whatsapp',
      notificationId: 'wa-1',
      title: 'OpenAI',
      body: '123456',
      receivedAt: '2026-04-30T17:52:00.000Z',
    }

    expect(deduper.shouldProcess(event, 100)).toBe(true)
    expect(deduper.shouldProcess(event, 200)).toBe(false)
    expect(deduper.shouldProcess(event, 1200)).toBe(true)
  })

  it('accepts SmsForwarder webhook posts and forwards Codey ingest payloads', async () => {
    const ingestNotification = vi.fn(async () => ({
      ok: true,
      notificationRecordId: 'notification-1',
      codeRecordId: 'code-1',
      match: {
        matched: true,
        reservationId: 'reservation-1',
        email: 'codey+otp@example.com',
      },
    }))
    const handle = startWhatsAppNotificationWebhookServer({
      port: 0,
      deviceId: 'emulator-5554',
      ingestNotification,
    })
    openHandles.push(handle)
    const { url } = await handle.ready

    const response = await postJson(url, {
      msg_app: 'WhatsApp',
      msg_title: 'OpenAI',
      msg_content: 'Your verification code is 135790.',
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      ok: true,
      extractedCode: '135790',
      notificationRecordId: 'notification-1',
      codeRecordId: 'code-1',
    })
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'emulator-5554',
        packageName: 'com.whatsapp',
        title: 'OpenAI',
        body: 'Your verification code is 135790.',
        extractedCode: '135790',
      }),
    )
  })

  it('accepts SmsForwarder JSON with raw control characters inside strings', async () => {
    const ingestNotification = vi.fn(async () => ({
      ok: true,
      notificationRecordId: 'notification-1',
      codeRecordId: 'code-1',
      match: {
        matched: true,
      },
    }))
    const handle = startWhatsAppNotificationWebhookServer({
      port: 0,
      ingestNotification,
    })
    openHandles.push(handle)
    const { url } = await handle.ready
    const rawBody =
      '{"msg_app":"WhatsApp","msg_title":"GoPay","msg_content":"Your code is\n135790"}'

    const response = await postRaw(url, rawBody)

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      ok: true,
      extractedCode: '135790',
    })
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: 'com.whatsapp',
        title: 'GoPay',
        body: 'Your code is\n135790',
        extractedCode: '135790',
      }),
    )
  })

  it('recovers SmsForwarder fields when malformed JSON parsing still fails', async () => {
    const ingestNotification = vi.fn(async () => ({
      ok: true,
      notificationRecordId: 'notification-1',
      codeRecordId: 'code-1',
      match: {
        matched: true,
      },
    }))
    const handle = startWhatsAppNotificationWebhookServer({
      port: 0,
      ingestNotification,
    })
    openHandles.push(handle)
    const { url } = await handle.ready
    const rawBody = `{
  "msg_app": "com.whatsapp",
  "msg_title": "GoPay\t",
  "msg_content": "811997 is your verification code. For your security, do not share this code.",
  "msg_time": "2026-05-02 12:54:47",
}`

    const response = await postRaw(url, rawBody)

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      ok: true,
      extractedCode: '811997',
    })
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: 'com.whatsapp',
        title: 'GoPay',
        body: '811997 is your verification code. For your security, do not share this code.',
        extractedCode: '811997',
      }),
    )
  })

  it('logs the raw webhook body when unrecoverable JSON parsing fails', async () => {
    const statuses: string[] = []
    const handle = startWhatsAppNotificationWebhookServer({
      port: 0,
      dryRun: true,
      onStatus: (message) => statuses.push(message),
    })
    openHandles.push(handle)
    const { url } = await handle.ready
    const rawBody = '{"msg_app":"WhatsApp","msg_content":"Your code is 135790"'

    const response = await postRaw(url, rawBody)

    expect(response.statusCode).toBe(400)
    expect(response.body).toMatchObject({
      ok: false,
      rawBody,
    })
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.stringContaining('SmsForwarder webhook request failed:'),
        `SmsForwarder webhook raw body: ${rawBody}`,
      ]),
    )
  })
})
