DROP INDEX "managed_identity_sessions_identity_id_unique";--> statement-breakpoint
ALTER TABLE "managed_identity_sessions" ADD COLUMN "client_id" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
UPDATE "managed_identity_sessions"
SET "client_id" = NULLIF("session_data"->>'client_id', '')
WHERE COALESCE(NULLIF("session_data"->>'client_id', ''), '') <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "managed_identity_sessions_identity_client_unique" ON "managed_identity_sessions" USING btree ("identity_id","client_id");--> statement-breakpoint
CREATE INDEX "managed_identity_sessions_client_id_idx" ON "managed_identity_sessions" USING btree ("client_id");
