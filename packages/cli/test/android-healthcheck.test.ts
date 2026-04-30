import { describe, expect, it, vi } from 'vitest'
import { runAndroidHealthcheck } from '../src/flows/android-healthcheck'
import type { AndroidSession } from '../src/core/android'

describe('Android healthcheck flow', () => {
  it('reports Appium session and optional device details through the machine', async () => {
    const session = {
      sessionId: 'local-session-1',
      appiumSessionId: 'appium-session-1',
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': 'Pixel 8',
        'appium:udid': 'emulator-5554',
      },
      driver: {
        getCurrentPackage: vi.fn(async () => 'com.example.app'),
        getCurrentActivity: vi.fn(async () => '.MainActivity'),
        getContexts: vi.fn(async () => ['NATIVE_APP']),
      },
      close: vi.fn(async () => undefined),
    } as unknown as AndroidSession

    const updates: string[] = []
    const result = await runAndroidHealthcheck(session, {
      progressReporter: (update) => {
        if (update.message) {
          updates.push(update.message)
        }
      },
    })

    expect(result).toMatchObject({
      pageName: 'android-healthcheck',
      connected: true,
      appiumSessionId: 'appium-session-1',
      device: {
        automationName: 'UiAutomator2',
        deviceName: 'Pixel 8',
        udid: 'emulator-5554',
        currentPackage: 'com.example.app',
        currentActivity: '.MainActivity',
        contexts: ['NATIVE_APP'],
      },
    })
    expect(result.machine.state).toBe('completed')
    expect(updates).toContain('Appium Android session connected')
    expect(updates).toContain('Android healthcheck completed')
  })
})
