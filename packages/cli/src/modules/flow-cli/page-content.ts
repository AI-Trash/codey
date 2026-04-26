import path from 'path'
import type { Page } from 'patchright'
import { getRuntimeConfig } from '../../config'
import { ensureDir, writeFileAtomic } from '../../utils/fs'
import { sleep } from '../../utils/wait'

const DEFAULT_LOAD_STATE_TIMEOUT_MS = 1500
const DEFAULT_STABILITY_TIMEOUT_MS = 5000
const DEFAULT_POLL_INTERVAL_MS = 250

export interface SaveStablePageContentOptions {
  artifactName?: string
  artifactsDir?: string
  loadStateTimeoutMs?: number
  stabilityTimeoutMs?: number
  pollIntervalMs?: number
}

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

function normalizeTimeout(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function normalizePollInterval(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_POLL_INTERVAL_MS
}

function buildPageContentPath(input: {
  artifactsDir: string
  artifactName?: string
  command?: string
}): string {
  ensureDir(input.artifactsDir)
  const safeName = sanitizeArtifactName(
    input.artifactName || input.command || 'flow',
  )
  return path.join(
    input.artifactsDir,
    `${timeStamp()}-${safeName}-page-content.html`,
  )
}

async function waitForPageLoadState(
  page: Page,
  state: Parameters<Page['waitForLoadState']>[0],
  timeout: number,
): Promise<void> {
  if (timeout <= 0 || typeof page.waitForLoadState !== 'function') {
    return
  }

  await page.waitForLoadState(state, { timeout }).catch(() => undefined)
}

async function waitForStablePageContent(
  page: Page,
  options: SaveStablePageContentOptions,
): Promise<string> {
  const loadStateTimeoutMs = normalizeTimeout(
    options.loadStateTimeoutMs,
    DEFAULT_LOAD_STATE_TIMEOUT_MS,
  )
  const stabilityTimeoutMs = normalizeTimeout(
    options.stabilityTimeoutMs,
    DEFAULT_STABILITY_TIMEOUT_MS,
  )
  const pollIntervalMs = normalizePollInterval(options.pollIntervalMs)

  await waitForPageLoadState(page, 'domcontentloaded', loadStateTimeoutMs)
  await waitForPageLoadState(page, 'networkidle', loadStateTimeoutMs)

  const deadline = Date.now() + stabilityTimeoutMs
  let previousContent: string | undefined
  let latestContent: string | undefined

  do {
    if (typeof page.isClosed === 'function' && page.isClosed()) {
      throw new Error('Cannot capture page content because the page is closed.')
    }

    latestContent = await page.content()
    if (latestContent === previousContent) {
      return latestContent
    }

    previousContent = latestContent
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      break
    }

    await sleep(Math.min(pollIntervalMs, remainingMs))
  } while (Date.now() <= deadline)

  if (latestContent !== undefined) {
    return latestContent
  }

  return page.content()
}

export async function saveStablePageContent(
  page: Page,
  options: SaveStablePageContentOptions = {},
): Promise<string> {
  const config = getRuntimeConfig()
  const filePath = buildPageContentPath({
    artifactsDir: options.artifactsDir || config.artifactsDir,
    artifactName: options.artifactName,
    command: config.command,
  })
  const content = await waitForStablePageContent(page, options)
  writeFileAtomic(filePath, content)
  return filePath
}
