import crypto from 'crypto'
import { remote } from 'webdriverio'
import { getRuntimeConfig, type AndroidCliConfig } from '../config'
import {
  getCurrentObservabilityContext,
  logCliEvent,
  traceCliOperation,
  withObservabilityContext,
} from '../utils/observability'

export type AndroidDriver = Awaited<ReturnType<typeof remote>>

export interface AndroidSession {
  sessionId: string
  appiumSessionId?: string
  driver: AndroidDriver
  capabilities: Record<string, unknown>
  close(): Promise<void>
}

interface AppiumEndpoint {
  protocol: string
  hostname: string
  port: number
  path: string
}

function resolveAppiumEndpoint(serverUrl: string): AppiumEndpoint {
  const parsed = new URL(serverUrl)
  const protocol = parsed.protocol.replace(/:$/, '') || 'http'
  const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
  const path =
    parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/'

  return {
    protocol,
    hostname: parsed.hostname,
    port,
    path,
  }
}

function setCapability(
  capabilities: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null || value === '') {
    return
  }

  capabilities[key] = value
}

function buildAndroidCapabilities(
  config: AndroidCliConfig,
): Record<string, unknown> {
  const capabilities: Record<string, unknown> = {
    platformName: 'Android',
  }

  setCapability(capabilities, 'appium:automationName', config.automationName)
  setCapability(capabilities, 'appium:deviceName', config.deviceName)
  setCapability(capabilities, 'appium:platformVersion', config.platformVersion)
  setCapability(capabilities, 'appium:udid', config.udid)
  setCapability(capabilities, 'appium:appPackage', config.appPackage)
  setCapability(capabilities, 'appium:appActivity', config.appActivity)
  setCapability(capabilities, 'appium:noReset', config.noReset)

  return capabilities
}

function readDriverSessionId(driver: AndroidDriver): string | undefined {
  const candidate = (driver as { sessionId?: unknown }).sessionId
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : undefined
}

export async function newAndroidSession(): Promise<AndroidSession> {
  const config = getRuntimeConfig()
  const androidConfig = config.android
  if (!androidConfig) {
    throw new Error('Android runtime config is missing.')
  }
  const sessionId = crypto.randomUUID()
  const sessionContext = getCurrentObservabilityContext()

  return withObservabilityContext(
    {
      sessionId,
    },
    () =>
      traceCliOperation(
        'android.session',
        {
          sessionId,
          command: config.command,
          appiumServerUrl: androidConfig.appiumServerUrl,
          udidConfigured: Boolean(androidConfig.udid),
          appPackageConfigured: Boolean(androidConfig.appPackage),
        },
        async () => {
          const endpoint = resolveAppiumEndpoint(androidConfig.appiumServerUrl)
          const capabilities = buildAndroidCapabilities(androidConfig)
          let driver: AndroidDriver | undefined
          let closePromise: Promise<void> | undefined

          const logAndroidEvent = (
            event: string,
            data?: Record<string, unknown>,
          ) => {
            withObservabilityContext(
              {
                ...sessionContext,
                sessionId,
              },
              () => {
                logCliEvent('info', `android.${event}`, {
                  sessionId,
                  ...data,
                })
              },
            )
          }

          driver = await remote({
            ...endpoint,
            capabilities,
            connectionRetryCount: 0,
            logLevel: 'silent',
          })
          const appiumSessionId = readDriverSessionId(driver)
          logAndroidEvent('session.ready', {
            appiumSessionId,
            capabilities,
          })

          return {
            sessionId,
            appiumSessionId,
            driver,
            capabilities,
            async close() {
              if (!closePromise) {
                closePromise = traceCliOperation(
                  'android.session.close',
                  {
                    sessionId,
                    appiumSessionId,
                  },
                  async () => {
                    logAndroidEvent('session.closing')
                    await driver?.deleteSession().catch(() => undefined)
                    logAndroidEvent('session.closed')
                  },
                )
              }

              await closePromise
            },
          }
        },
      ),
  )
}
