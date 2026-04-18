import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getRuntimeConfig } from '../../config'
import { ensureDir, writeFileAtomic } from '../../utils/fs'
import type {
  ChatGPTAuthSessionPayload,
  ChatGPTSessionSnapshot,
} from '../chatgpt/session'

const STORE_VERSION = 1
const STORE_DIR = '.codey/credentials'
const STORE_SESSIONS_DIR_NAME = 'chatgpt-sessions'

export interface StoredChatGPTSession {
  version: number
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  auth: ChatGPTAuthSessionPayload
  sessionId?: string
  accountId?: string
  subject?: string
  authProvider?: string
  expiresAt?: string
  createdAt: string
  updatedAt: string
}

export interface StoredChatGPTSessionSummary {
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  authMode: 'chatgpt'
  sessionId?: string
  accountId?: string
  expiresAt?: string
  lastRefresh: string
  hasRefreshToken: boolean
  hasIdToken: boolean
  storePath: string
}

function getStoreRootPath(): string {
  const config = getRuntimeConfig()
  return path.join(config.rootDir, STORE_DIR)
}

function getSessionsDirectoryPath(): string {
  return path.join(getStoreRootPath(), STORE_SESSIONS_DIR_NAME)
}

function createSessionFileName(input: {
  identityId: string
  email: string
}): string {
  const normalizedEmail = input.email.trim().toLowerCase()
  const emailDigest = crypto
    .createHash('sha1')
    .update(`${input.identityId}:${normalizedEmail}`)
    .digest('hex')
    .slice(0, 12)
  const safeEmail =
    normalizedEmail
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'session'
  return `${safeEmail}--${emailDigest}.json`
}

function getSessionStorePath(input: {
  identityId: string
  email: string
}): string {
  return path.join(getSessionsDirectoryPath(), createSessionFileName(input))
}

function readExistingCreatedAt(storePath: string): string | undefined {
  if (!fs.existsSync(storePath)) {
    return undefined
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(storePath, 'utf8'),
    ) as Partial<StoredChatGPTSession>
    return typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined
  } catch {
    return undefined
  }
}

function summarize(
  session: StoredChatGPTSession,
  storePath: string,
): StoredChatGPTSessionSummary {
  return {
    identityId: session.identityId,
    email: session.email,
    flowType: session.flowType,
    authMode: session.auth.auth_mode,
    sessionId: session.sessionId,
    accountId: session.accountId,
    expiresAt: session.expiresAt,
    lastRefresh: session.auth.last_refresh,
    hasRefreshToken: Boolean(session.auth.tokens.refresh_token),
    hasIdToken: Boolean(session.auth.tokens.id_token),
    storePath,
  }
}

export function persistChatGPTSession(input: {
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  snapshot: ChatGPTSessionSnapshot
}): {
  session: StoredChatGPTSession
  summary: StoredChatGPTSessionSummary
} {
  const storePath = getSessionStorePath({
    identityId: input.identityId,
    email: input.email,
  })
  const createdAt = readExistingCreatedAt(storePath) || input.snapshot.capturedAt
  const session: StoredChatGPTSession = {
    version: STORE_VERSION,
    identityId: input.identityId,
    email: input.email.trim().toLowerCase(),
    flowType: input.flowType,
    auth: input.snapshot.auth,
    sessionId: input.snapshot.sessionId,
    accountId: input.snapshot.accountId,
    subject: input.snapshot.subject,
    authProvider: input.snapshot.authProvider,
    expiresAt: input.snapshot.expiresAt,
    createdAt,
    updatedAt: input.snapshot.capturedAt,
  }

  ensureDir(path.dirname(storePath))
  writeFileAtomic(storePath, `${JSON.stringify(session, null, 2)}\n`)

  return {
    session,
    summary: summarize(session, storePath),
  }
}
