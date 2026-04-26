import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { getRuntimeConfig } from '../../config'
import { ensureDir, writeFileAtomic } from '../../utils/fs'

interface StoredCliWorkerId {
  version: 1
  workerId: string
  cliName: string
  target?: string
  createdAt: string
}

function normalizeScopeSegment(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = value?.trim().toLowerCase() || fallback
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || fallback
}

function getStorePath(input: { cliName: string; target?: string }): string {
  const config = getRuntimeConfig()
  const cliName = normalizeScopeSegment(input.cliName, 'codey')
  const target = normalizeScopeSegment(input.target, 'shared')
  return path.join(
    config.rootDir,
    '.codey',
    'workers',
    `${cliName}__${target}.json`,
  )
}

function createStoredCliWorkerId(input: {
  cliName: string
  target?: string
}): StoredCliWorkerId {
  return {
    version: 1,
    workerId: crypto.randomUUID(),
    cliName: input.cliName.trim() || 'codey',
    target: input.target?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }
}

function readStoredCliWorkerId(storePath: string): StoredCliWorkerId | null {
  if (!fs.existsSync(storePath)) {
    return null
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(storePath, 'utf8'),
    ) as Partial<StoredCliWorkerId>
    if (
      parsed?.version === 1 &&
      typeof parsed.workerId === 'string' &&
      parsed.workerId.trim()
    ) {
      return {
        version: 1,
        workerId: parsed.workerId.trim(),
        cliName:
          typeof parsed.cliName === 'string' && parsed.cliName.trim()
            ? parsed.cliName.trim()
            : 'codey',
        target:
          typeof parsed.target === 'string' && parsed.target.trim()
            ? parsed.target.trim()
            : undefined,
        createdAt:
          typeof parsed.createdAt === 'string' && parsed.createdAt.trim()
            ? parsed.createdAt.trim()
            : new Date().toISOString(),
      }
    }
  } catch {}

  return null
}

export function resolveCliWorkerId(input: {
  cliName: string
  target?: string
}): string {
  const storePath = getStorePath(input)
  const existing = readStoredCliWorkerId(storePath)
  if (existing) {
    return existing.workerId
  }

  const created = createStoredCliWorkerId(input)
  ensureDir(path.dirname(storePath))
  writeFileAtomic(storePath, `${JSON.stringify(created, null, 2)}\n`)
  return created.workerId
}
