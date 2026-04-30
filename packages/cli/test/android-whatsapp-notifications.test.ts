import { describe, expect, it } from 'vitest'
import {
  buildWhatsAppNotificationIngestPayload,
  buildFridaServerDownloadUrl,
  createWhatsAppNotificationDeduper,
  extractVerificationCodeFromNotificationText,
  mapAndroidAbiToFridaArch,
  normalizeFridaWhatsAppNotificationMessage,
  normalizeWhatsAppPackageList,
} from '../src/modules/android/whatsapp-notifications'

describe('Android WhatsApp notification helpers', () => {
  it('normalizes comma-separated WhatsApp package lists', () => {
    expect(
      normalizeWhatsAppPackageList('com.whatsapp, com.whatsapp.w4b'),
    ).toEqual(['com.whatsapp', 'com.whatsapp.w4b'])
  })

  it('uses WhatsApp and WhatsApp Business as default package targets', () => {
    expect(normalizeWhatsAppPackageList(undefined)).toEqual([
      'com.whatsapp',
      'com.whatsapp.w4b',
    ])
  })

  it('maps Android ABIs to Frida server release architectures', () => {
    expect(mapAndroidAbiToFridaArch('arm64-v8a')).toBe('arm64')
    expect(mapAndroidAbiToFridaArch('armeabi-v7a')).toBe('arm')
    expect(mapAndroidAbiToFridaArch('x86_64')).toBe('x86_64')
    expect(mapAndroidAbiToFridaArch('mips')).toBeUndefined()
  })

  it('builds the Frida server release download URL', () => {
    expect(
      buildFridaServerDownloadUrl({
        version: '17.9.3',
        arch: 'arm64',
      }),
    ).toBe(
      'https://github.com/frida/frida/releases/download/17.9.3/frida-server-17.9.3-android-arm64.xz',
    )
  })

  it('normalizes Frida send messages into notification events', () => {
    expect(
      normalizeFridaWhatsAppNotificationMessage({
        type: 'send',
        payload: {
          type: 'whatsapp_notification',
          packageName: 'com.whatsapp',
          notificationId: '0|com.whatsapp|42',
          title: 'OpenAI',
          body: 'Your verification code is 123456.',
          rawPayload: {
            source: 'NotificationManagerService',
          },
          receivedAt: '2026-04-30T17:50:00.000Z',
        },
      }),
    ).toEqual({
      packageName: 'com.whatsapp',
      notificationId: '0|com.whatsapp|42',
      title: 'OpenAI',
      body: 'Your verification code is 123456.',
      rawPayload: {
        source: 'NotificationManagerService',
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
})
