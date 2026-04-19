import fs from 'fs'
import path from 'path'
import { chromium, type Browser, type BrowserContext } from 'patchright'
import { getRuntimeConfig } from '../config'
import { ensureDir } from '../utils/fs'
import type { Session } from '../types'

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
): Parameters<Browser['newContext']>[0] {
  return {
    viewport: { width: 1440, height: 960 },
    ignoreHTTPSErrors: true,
    ...(harPath ? ({ recordHar: { path: harPath } } as object) : {}),
    ...context,
  }
}

export async function newSession(
  options: {
    artifactName?: string
    context?: Parameters<Browser['newContext']>[0]
  } = {},
): Promise<Session> {
  const config = getRuntimeConfig()
  const harPath = config.browser.recordHar
    ? buildHarPath(config.artifactsDir, options.artifactName, config.command)
    : undefined
  const contextOptions = buildContextOptions(harPath, options.context)
  let browser: Browser | null = null
  let context: BrowserContext

  if (config.browser.userDataDir) {
    if (
      config.browser.profileDirectory &&
      !fs.existsSync(
        path.join(config.browser.userDataDir, config.browser.profileDirectory),
      )
    ) {
      throw new Error(
        `Chrome profile directory not found: ${path.join(config.browser.userDataDir, config.browser.profileDirectory)}`,
      )
    }

    context = await chromium.launchPersistentContext(
      config.browser.userDataDir,
      {
        channel: 'chrome',
        headless: config.browser.headless,
        slowMo: config.browser.slowMo,
        ...(config.browser.profileDirectory
          ? {
              args: [`--profile-directory=${config.browser.profileDirectory}`],
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

  const page = await context.newPage()
  page.setDefaultTimeout(config.browser.defaultTimeoutMs)
  page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs)
  let closePromise: Promise<void> | undefined

  return {
    browser,
    context,
    page,
    harPath,
    async close() {
      if (!closePromise) {
        closePromise = (async () => {
          await context.close().catch(() => {})
          await browser?.close().catch(() => {})
        })()
      }

      await closePromise
    },
  }
}
