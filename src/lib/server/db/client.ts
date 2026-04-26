import '@tanstack/react-start/server-only'

import path from 'node:path'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { getAppEnv } from '../env'
import * as schema from './schema'

type SqlClient = ReturnType<typeof postgres>

declare global {
  var __codeyPostgresClient: SqlClient | undefined
  var __codeyDb: PostgresJsDatabase<typeof schema> | undefined
  var __codeyDbMigrationPromise: Promise<void> | undefined
}

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle')

function createClient(): SqlClient {
  const { databaseUrl } = getAppEnv()
  return postgres(databaseUrl, {
    max: process.env.NODE_ENV === 'production' ? 10 : 1,
    prepare: false,
  })
}

function createDatabase(client: SqlClient): PostgresJsDatabase<typeof schema> {
  return drizzle(client, { schema, logger: false })
}

export function getQueryClient(): SqlClient {
  if (!globalThis.__codeyPostgresClient) {
    globalThis.__codeyPostgresClient = createClient()
  }

  return globalThis.__codeyPostgresClient
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!globalThis.__codeyDb) {
    globalThis.__codeyDb = createDatabase(getQueryClient())
  }

  return globalThis.__codeyDb
}

async function ensureDatabaseReady(): Promise<void> {
  if (!globalThis.__codeyDbMigrationPromise) {
    globalThis.__codeyDbMigrationPromise = migrate(getDb(), {
      migrationsFolder: MIGRATIONS_FOLDER,
    }).catch((error) => {
      globalThis.__codeyDbMigrationPromise = undefined
      throw error
    })
  }

  await globalThis.__codeyDbMigrationPromise
}

await ensureDatabaseReady()

export const queryClient = new Proxy({} as SqlClient, {
  get(_target, property, receiver) {
    return Reflect.get(getQueryClient(), property, receiver)
  },
}) as SqlClient

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver)
  },
}) as PostgresJsDatabase<typeof schema>

export type Database = PostgresJsDatabase<typeof schema>
