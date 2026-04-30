import { Readable } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildWhatsAppNotificationIngestPayload,
  buildFridaServerDownloadUrl,
  createWhatsAppNotificationDeduper,
  extractVerificationCodeFromNotificationText,
  formatAndroidFridaError,
  getAndroidStudioAdbPathCandidates,
  isRecoverableFridaServerConnectionError,
  mapAndroidAbiToFridaArch,
  normalizeFridaWhatsAppNotificationMessage,
  normalizeWhatsAppPackageList,
  runAndroidWhatsAppNotificationWatcher,
} from '../src/modules/android/whatsapp-notifications'

const androidRuntimeMocks = vi.hoisted(() => ({
  adb: {
    forward: vi.fn(),
    listDevices: vi.fn(),
    push: vi.fn(),
    shell: vi.fn(),
  },
  createAdbClient: vi.fn(),
  frida: {
    getDevice: vi.fn(),
    getDeviceManager: vi.fn(),
    getUsbDevice: vi.fn(),
  },
}))

vi.mock('adbkit', () => ({
  createClient: androidRuntimeMocks.createAdbClient,
  default: {
    createClient: androidRuntimeMocks.createAdbClient,
  },
}))

vi.mock('frida', () => ({
  default: androidRuntimeMocks.frida,
  getDevice: androidRuntimeMocks.frida.getDevice,
  getDeviceManager: androidRuntimeMocks.frida.getDeviceManager,
  getUsbDevice: androidRuntimeMocks.frida.getUsbDevice,
}))

function textStream(value = ''): NodeJS.ReadableStream {
  return Readable.from(value ? [value] : [])
}

describe('Android WhatsApp notification helpers', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('prefers Android Studio SDK adb paths before PATH on Windows', () => {
    expect(
      getAndroidStudioAdbPathCandidates({
        env: {
          LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
          USERPROFILE: 'C:\\Users\\me',
        },
        homeDir: 'C:\\Users\\me',
        platform: 'win32',
      }),
    ).toEqual([
      'C:\\Users\\me\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
      'adb.exe',
      'adb',
    ])
  })

  it('prefers Android Studio SDK adb paths before PATH on macOS', () => {
    expect(
      getAndroidStudioAdbPathCandidates({
        env: {},
        homeDir: '/Users/me',
        platform: 'darwin',
      }),
    ).toEqual(['/Users/me/Library/Android/sdk/platform-tools/adb', 'adb'])
  })

  it('prefers Android Studio SDK adb paths before PATH on Linux', () => {
    expect(
      getAndroidStudioAdbPathCandidates({
        env: {},
        homeDir: '/home/me',
        platform: 'linux',
      }),
    ).toEqual([
      '/home/me/Android/Sdk/platform-tools/adb',
      '/home/me/Android/sdk/platform-tools/adb',
      'adb',
    ])
  })

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

  it('explains closed Frida transport errors', () => {
    const error = new Error('Unable to connect to remote frida-server: closed')

    expect(isRecoverableFridaServerConnectionError(error)).toBe(true)
    expect(formatAndroidFridaError(error)).toContain(
      'Frida reported a closed transport connection',
    )
  })

  it('restarts frida-server and retries once when attaching closes the transport', async () => {
    const statuses: string[] = []
    const script = {
      load: vi.fn(async () => undefined),
      message: {
        connect: vi.fn(),
      },
      unload: vi.fn(async () => undefined),
    }
    const session = {
      createScript: vi.fn(async () => script),
      detach: vi.fn(async () => undefined),
    }
    const device = {
      attach: vi
        .fn()
        .mockRejectedValueOnce(
          new Error('Unable to connect to remote frida-server: closed'),
        )
        .mockResolvedValueOnce(session),
      id: 'emulator-5554',
      name: 'Android Emulator 5554',
    }

    androidRuntimeMocks.createAdbClient.mockReturnValue(androidRuntimeMocks.adb)
    androidRuntimeMocks.adb.listDevices.mockResolvedValue([
      {
        id: 'emulator-5554',
        type: 'device',
      },
    ])
    androidRuntimeMocks.adb.shell.mockImplementation(
      async (_serial: string, command: string) =>
        command.includes('if [ -f')
          ? textStream('found\n')
          : command.includes('--version')
            ? textStream('17.9.3\n')
            : textStream(),
    )
    androidRuntimeMocks.adb.push.mockResolvedValue(textStream())
    androidRuntimeMocks.adb.forward.mockResolvedValue(undefined)
    androidRuntimeMocks.frida.getDeviceManager.mockResolvedValue({
      enumerateDevices: vi.fn(async () => [device]),
    })

    const result = await runAndroidWhatsAppNotificationWatcher({
      dryRun: true,
      durationMs: 1,
      onStatus: (status) => statuses.push(status),
      whatsappPackages: ['com.whatsapp'],
    })

    expect(result.serial).toBe('emulator-5554')
    expect(device.attach).toHaveBeenCalledTimes(2)
    expect(
      androidRuntimeMocks.adb.shell.mock.calls.filter(([, command]) =>
        String(command).includes('pkill -f frida-server'),
      ),
    ).toHaveLength(2)
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.stringContaining('restarting frida-server and retrying once'),
        'Watching com.whatsapp notifications on emulator-5554 via system_server',
      ]),
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
