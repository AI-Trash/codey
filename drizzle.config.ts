import 'dotenv/config'

import { defineConfig } from 'drizzle-kit'

function readDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required and must use a postgres:// or postgresql:// URL.',
    )
  }

  let protocol: string
  try {
    protocol = new URL(databaseUrl).protocol
  } catch {
    throw new Error(
      'DATABASE_URL must be a valid postgres:// or postgresql:// URL.',
    )
  }

  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error(
      'DATABASE_URL must use PostgreSQL. SQLite and other database engines are not supported.',
    )
  }

  return databaseUrl
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: readDatabaseUrl(),
  },
  strict: true,
  verbose: true,
})
