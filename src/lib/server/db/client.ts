import '@tanstack/react-start/server-only'

import path from 'node:path'
import { sql } from 'drizzle-orm'
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
const SCHEMA_REPAIR_ADVISORY_LOCK_KEY = 2026050902

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

async function repairVerificationDomainsSchema(): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${SCHEMA_REPAIR_ADVISORY_LOCK_KEY})`,
    )

    await tx.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.verification_domains') IS NULL THEN
          RETURN;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'verification_domains'
            AND column_name = 'mailbox_prefix'
        ) THEN
          ALTER TABLE "verification_domains" ADD COLUMN "mailbox_prefix" text;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'verification_domains'
            AND column_name = 'mailbox_type'
        ) THEN
          ALTER TABLE "verification_domains"
            ADD COLUMN "mailbox_type" text DEFAULT 'cloudflare';
        END IF;

        DROP INDEX IF EXISTS "verification_domains_enabled_domain_idx";

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'verification_domains'
            AND column_name = 'enabled'
        ) THEN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'verification_domains'
              AND column_name = 'registration_enabled'
          ) THEN
            UPDATE "verification_domains"
            SET "registration_enabled" = COALESCE(
              "registration_enabled",
              "enabled",
              true
            );
            ALTER TABLE "verification_domains" DROP COLUMN "enabled";
          ELSE
            ALTER TABLE "verification_domains"
              RENAME COLUMN "enabled" TO "registration_enabled";
          END IF;
        ELSIF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'verification_domains'
            AND column_name = 'registration_enabled'
        ) THEN
          ALTER TABLE "verification_domains"
            ADD COLUMN "registration_enabled" boolean DEFAULT true;
        END IF;

        UPDATE "verification_domains"
        SET "mailbox_type" = 'cloudflare'
        WHERE "mailbox_type" IS NULL;

        ALTER TABLE "verification_domains"
          ALTER COLUMN "mailbox_type" SET DEFAULT 'cloudflare';
        ALTER TABLE "verification_domains"
          ALTER COLUMN "mailbox_type" SET NOT NULL;

        UPDATE "verification_domains"
        SET "registration_enabled" = true
        WHERE "registration_enabled" IS NULL;

        ALTER TABLE "verification_domains"
          ALTER COLUMN "registration_enabled" SET DEFAULT true;
        ALTER TABLE "verification_domains"
          ALTER COLUMN "registration_enabled" SET NOT NULL;

        CREATE INDEX IF NOT EXISTS "verification_domains_registration_enabled_domain_idx"
          ON "verification_domains" USING btree ("registration_enabled", "domain");
      END $$;
    `)
  })
}

async function repairPersonalMailboxesSchema(): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${SCHEMA_REPAIR_ADVISORY_LOCK_KEY})`,
    )

    await tx.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_enum
          WHERE enumlabel = 'OUTLOOK_GRAPH'
            AND enumtypid = 'verification_code_source'::regtype
        ) THEN
          ALTER TYPE "verification_code_source" ADD VALUE 'OUTLOOK_GRAPH';
        END IF;

        CREATE TABLE IF NOT EXISTS "personal_mailbox_credentials" (
          "id" text PRIMARY KEY NOT NULL,
          "verification_domain_id" text NOT NULL REFERENCES "verification_domains"("id") ON DELETE cascade,
          "provider" text DEFAULT 'outlook' NOT NULL,
          "graph_tenant_id" text DEFAULT 'common' NOT NULL,
          "graph_client_id" text NOT NULL,
          "graph_scopes" text DEFAULT 'https://graph.microsoft.com/Mail.Read offline_access' NOT NULL,
          "graph_refresh_token_ciphertext" text NOT NULL,
          "graph_refresh_token_preview" text,
          "password_ciphertext" text,
          "password_preview" text,
          "last_graph_read_at" timestamp with time zone,
          "last_graph_error" text,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "updated_at" timestamp with time zone DEFAULT now() NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "personal_mailbox_credentials_domain_unique"
          ON "personal_mailbox_credentials" USING btree ("verification_domain_id");
        CREATE INDEX IF NOT EXISTS "personal_mailbox_credentials_provider_idx"
          ON "personal_mailbox_credentials" USING btree ("provider");
      END $$;
    `)
  })
}

async function ensureDatabaseReady(): Promise<void> {
  if (!globalThis.__codeyDbMigrationPromise) {
    globalThis.__codeyDbMigrationPromise = migrate(getDb(), {
      migrationsFolder: MIGRATIONS_FOLDER,
    })
      .then(() => repairVerificationDomainsSchema())
      .then(() => repairPersonalMailboxesSchema())
      .catch((error) => {
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
