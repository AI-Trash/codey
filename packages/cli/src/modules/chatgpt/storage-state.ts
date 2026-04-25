import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { Page } from 'patchright'
import { getRuntimeConfig } from '../../config'
import { ensureDir, writeFileAtomic } from '../../utils/fs'

export interface LocalChatGPTStorageStateEntry {
  identityId: string
  email: string
  storageStatePath: string
  flowType: string
  createdAt: string
  updatedAt: string
}

export interface LocalChatGPTStorageStateAffinity {
  identityIds: string[]
  emails: string[]
}

interface LocalChatGPTStorageStateIndex {
  version: 1
  entries: LocalChatGPTStorageStateEntry[]
}

const STORAGE_STATE_INDEX_FILE = 'index.json'
const MAX_REPORTED_STORAGE_STATE_AFFINITIES = 100

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  return normalizeText(value)?.toLowerCase()
}

function getStorageStateRoot(): string {
  return path.join(
    getRuntimeConfig().rootDir,
    '.codey',
    'storage-state',
    'chatgpt',
  )
}

function getStorageStateIndexPath(): string {
  return path.join(getStorageStateRoot(), STORAGE_STATE_INDEX_FILE)
}

function buildStorageStateFileName(input: {
  identityId?: string
  email?: string
}): string {
  const identityId = normalizeText(input.identityId)
  if (identityId) {
    const safeIdentityId =
      identityId
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'identity'
    return `${safeIdentityId}.json`
  }

  const email = normalizeEmail(input.email) || 'unknown'
  const digest = crypto.createHash('sha256').update(email).digest('hex')
  return `email-${digest.slice(0, 24)}.json`
}

function readStorageStateIndex(): LocalChatGPTStorageStateIndex {
  const indexPath = getStorageStateIndexPath()
  if (!fs.existsSync(indexPath)) {
    return {
      version: 1,
      entries: [],
    }
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(indexPath, 'utf8'),
    ) as Partial<LocalChatGPTStorageStateIndex>
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter(isStorageStateEntry)
      : []
    return {
      version: 1,
      entries,
    }
  } catch {
    return {
      version: 1,
      entries: [],
    }
  }
}

function writeStorageStateIndex(index: LocalChatGPTStorageStateIndex): void {
  writeFileAtomic(
    getStorageStateIndexPath(),
    `${JSON.stringify(index, null, 2)}\n`,
  )
}

function isStorageStateEntry(
  value: unknown,
): value is LocalChatGPTStorageStateEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Partial<LocalChatGPTStorageStateEntry>
  return (
    typeof candidate.identityId === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.storageStatePath === 'string' &&
    typeof candidate.flowType === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  )
}

function entryHasExistingStorageState(
  entry: LocalChatGPTStorageStateEntry,
): boolean {
  return Boolean(
    entry.storageStatePath && fs.existsSync(entry.storageStatePath),
  )
}

export function resolveLocalChatGPTStorageState(input: {
  identityId?: string | null
  email?: string | null
}): LocalChatGPTStorageStateEntry | undefined {
  const identityId = normalizeText(input.identityId)
  const email = normalizeEmail(input.email)
  if (!identityId && !email) {
    return undefined
  }

  const index = readStorageStateIndex()
  const matches = index.entries
    .filter((entry) => {
      if (identityId && entry.identityId === identityId) {
        return true
      }

      return Boolean(email && entry.email.toLowerCase() === email)
    })
    .filter(entryHasExistingStorageState)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.identityId.localeCompare(right.identityId),
    )

  return matches[0]
}

export function listLocalChatGPTStorageStateAffinities(): LocalChatGPTStorageStateAffinity {
  const entries = readStorageStateIndex()
    .entries.filter(entryHasExistingStorageState)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.identityId.localeCompare(right.identityId),
    )
    .slice(0, MAX_REPORTED_STORAGE_STATE_AFFINITIES)

  return {
    identityIds: Array.from(
      new Set(entries.map((entry) => entry.identityId).filter(Boolean)),
    ),
    emails: Array.from(
      new Set(
        entries
          .map((entry) => normalizeEmail(entry.email))
          .filter((email): email is string => Boolean(email)),
      ),
    ),
  }
}

export async function saveLocalChatGPTStorageState(
  page: Page,
  input: {
    identityId: string
    email: string
    flowType: string
  },
): Promise<LocalChatGPTStorageStateEntry> {
  const identityId = normalizeText(input.identityId)
  const email = normalizeEmail(input.email)
  if (!identityId || !email) {
    throw new Error(
      'ChatGPT storage state requires both an identity id and email.',
    )
  }

  const root = getStorageStateRoot()
  ensureDir(root)
  const storageStatePath = path.join(
    root,
    buildStorageStateFileName({ identityId, email }),
  )
  const now = new Date().toISOString()
  const existingIndex = readStorageStateIndex()
  const existingEntry = existingIndex.entries.find(
    (entry) =>
      entry.identityId === identityId || entry.email.toLowerCase() === email,
  )
  const storageState = await page.context().storageState({
    indexedDB: true,
  })

  writeFileAtomic(
    storageStatePath,
    `${JSON.stringify(storageState, null, 2)}\n`,
  )

  const nextEntry: LocalChatGPTStorageStateEntry = {
    identityId,
    email,
    storageStatePath,
    flowType: normalizeText(input.flowType) || 'chatgpt',
    createdAt: existingEntry?.createdAt || now,
    updatedAt: now,
  }
  const entries = [
    nextEntry,
    ...existingIndex.entries.filter(
      (entry) =>
        entry.identityId !== identityId && entry.email.toLowerCase() !== email,
    ),
  ]

  writeStorageStateIndex({
    version: 1,
    entries,
  })

  return nextEntry
}
