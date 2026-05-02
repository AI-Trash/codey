import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'patchright'
import { getRuntimeConfig } from '../config'
import { ensureDir } from '../utils/fs'
import {
  getCurrentObservabilityContext,
  logCliEvent,
  traceCliOperation,
  withObservabilityContext,
} from '../utils/observability'
import { cloneChromeUserDataDirToTemp } from '../utils/chrome-user-data-dir'
import type { Session } from '../types'
import { getCurrentCodeySingBoxProxy } from '../modules/proxy/sing-box'

type BrowserContextOptions = NonNullable<Parameters<Browser['newContext']>[0]>

function timeStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function sanitizeArtifactName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'flow'
  )
}

function buildHarPath(
  artifactsDir: string,
  artifactName?: string,
  command?: string,
): string {
  ensureDir(artifactsDir)
  const safeName = sanitizeArtifactName(artifactName || command || 'flow')
  return path.join(artifactsDir, `${timeStamp()}-${safeName}.har`)
}

export async function launchBrowser(): Promise<Browser> {
  const config = getRuntimeConfig()
  ensureDir(config.artifactsDir)

  return chromium.launch({
    channel: 'chrome',
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
  })
}

function buildContextOptions(
  harPath: string | undefined,
  context: Parameters<Browser['newContext']>[0] | undefined,
  proxy: BrowserContextOptions['proxy'] | undefined,
): Parameters<Browser['newContext']>[0] {
  return {
    viewport: { width: 1440, height: 960 },
    ignoreHTTPSErrors: true,
    ...(harPath ? ({ recordHar: { path: harPath } } as object) : {}),
    ...(proxy ? { proxy } : {}),
    ...context,
  }
}

async function resolveSessionPage(context: BrowserContext): Promise<Page> {
  const existingPage = context
    .pages()
    .find((candidate) => !candidate.isClosed())

  if (existingPage) {
    return existingPage
  }

  return context.newPage()
}

export async function newSession(
  options: {
    artifactName?: string
    context?: Parameters<Browser['newContext']>[0]
    storageStatePath?: string
  } = {},
): Promise<Session> {
  const config = getRuntimeConfig()
  const singBoxProxy = getCurrentCodeySingBoxProxy()
  const sessionId = crypto.randomUUID()
  const sessionContext = getCurrentObservabilityContext()

  return withObservabilityContext(
    {
      sessionId,
    },
    () =>
      traceCliOperation(
        'browser.session',
        {
          sessionId,
          command: config.command,
          artifactName: options.artifactName,
          persistentContext: Boolean(config.browser.userDataDir),
          headless: config.browser.headless,
          proxyConfigured: Boolean(singBoxProxy || config.browser.proxy),
          proxyRuntimeId: singBoxProxy?.runtimeId,
        },
        async () => {
          const harPath = config.browser.recordHar
            ? buildHarPath(
                config.artifactsDir,
                options.artifactName,
                config.command,
              )
            : undefined
          const contextOptions = buildContextOptions(
            harPath,
            options.context,
            singBoxProxy
              ? {
                  server: singBoxProxy.mixedProxy.server,
                  bypass: 'localhost,127.0.0.1,::1',
                }
              : config.browser.proxy,
          )
          let browser: Browser | null = null
          let context: BrowserContext
          let userDataDirCleanup: (() => Promise<void>) | undefined

          const logBrowserEvent = (
            event: string,
            data?: Record<string, unknown>,
          ) => {
            withObservabilityContext(
              {
                ...sessionContext,
                sessionId,
              },
              () => {
                logCliEvent('info', `browser.${event}`, {
                  sessionId,
                  ...data,
                })
              },
            )
          }

          const pageIds = new WeakMap<Page, string>()
          const attachPageLogging = (candidate: Page) => {
            const pageId = pageIds.get(candidate) || crypto.randomUUID()
            pageIds.set(candidate, pageId)

            if (typeof candidate.on !== 'function') {
              return
            }

            candidate.on('close', () => {
              logBrowserEvent('page.closed', {
                pageId,
              })
            })
            candidate.on('crash', () => {
              logBrowserEvent('page.crashed', {
                pageId,
              })
            })
            candidate.on('pageerror', (error) => {
              logBrowserEvent('page.error', {
                pageId,
                error:
                  error instanceof Error
                    ? error.stack || error.message
                    : String(error),
              })
            })
          }

          try {
            if (config.browser.userDataDir) {
              let launchUserDataDir = config.browser.userDataDir
              let launchProfileDirectory = config.browser.profileDirectory

              if (config.browser.cloneUserDataDirToTemp) {
                const clonedUserDataDir = await cloneChromeUserDataDirToTemp({
                  sourceUserDataDir: config.browser.userDataDir,
                  profileDirectory: config.browser.profileDirectory,
                })
                launchUserDataDir = clonedUserDataDir.userDataDir
                launchProfileDirectory = clonedUserDataDir.profileDirectory
                userDataDirCleanup = clonedUserDataDir.cleanup
              }

              if (
                launchProfileDirectory &&
                !fs.existsSync(
                  path.join(launchUserDataDir, launchProfileDirectory),
                )
              ) {
                throw new Error(
                  `Chrome profile directory not found: ${path.join(launchUserDataDir, launchProfileDirectory)}`,
                )
              }

              context = await chromium.launchPersistentContext(
                launchUserDataDir,
                {
                  channel: 'chrome',
                  headless: config.browser.headless,
                  slowMo: config.browser.slowMo,
                  ...(launchProfileDirectory
                    ? {
                        args: [`--profile-directory=${launchProfileDirectory}`],
                      }
                    : {}),
                  ...contextOptions,
                },
              )
              browser = context.browser()
            } else {
              browser = await launchBrowser()
              context = await browser.newContext(contextOptions)
            }
          } catch (error) {
            await userDataDirCleanup?.().catch(() => undefined)
            throw error
          }

          if (options.storageStatePath) {
            await context.setStorageState(options.storageStatePath)
            logBrowserEvent('storage_state.loaded', {
              storageStatePath: options.storageStatePath,
            })
          }

          if (typeof context.on === 'function') {
            context.on('page', (candidate) => {
              attachPageLogging(candidate)
              logBrowserEvent('context.page', {
                pageId: pageIds.get(candidate),
              })
            })
            context.on('close', () => {
              logBrowserEvent('context.closed')
            })
          }

          if (typeof browser?.on === 'function') {
            browser.on('disconnected', () => {
              logBrowserEvent('browser.disconnected')
            })
          }

          const page = await resolveSessionPage(context)
          attachPageLogging(page)
          page.setDefaultTimeout(config.browser.defaultTimeoutMs)
          page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs)
          logBrowserEvent('session.ready', {
            harPath,
            pageId: pageIds.get(page),
          })

          let closePromise: Promise<void> | undefined

          return {
            sessionId,
            browser,
            context,
            page,
            harPath,
            async close() {
              if (!closePromise) {
                closePromise = traceCliOperation(
                  'browser.session.close',
                  {
                    sessionId,
                  },
                  async () => {
                    logBrowserEvent('session.closing')
                    await context.close().catch(() => {})
                    await browser?.close().catch(() => {})
                    await userDataDirCleanup?.().catch(() => undefined)
                    logBrowserEvent('session.closed')
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
