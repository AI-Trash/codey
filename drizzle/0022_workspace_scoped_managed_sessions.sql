ALTER TABLE "managed_identity_sessions" ADD COLUMN "workspace_id" text;--> statement-breakpoint
DROP INDEX "managed_identity_sessions_identity_client_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "managed_identity_sessions_identity_client_workspace_unique" ON "managed_identity_sessions" USING btree ("identity_id","client_id","workspace_id");--> statement-breakpoint
CREATE INDEX "managed_identity_sessions_identity_workspace_last_seen_idx" ON "managed_identity_sessions" USING btree ("identity_id","workspace_id","last_seen_at");
