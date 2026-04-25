ALTER TABLE "cli_connections" ADD COLUMN "storage_state_identity_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "storage_state_emails" text[] DEFAULT '{}'::text[] NOT NULL;
