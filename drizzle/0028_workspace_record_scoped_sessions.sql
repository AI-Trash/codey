ALTER TABLE "managed_identity_sessions" ADD COLUMN "workspace_record_id" text;--> statement-breakpoint
CREATE INDEX "managed_identity_sessions_identity_ws_record_last_seen_idx" ON "managed_identity_sessions" USING btree ("identity_id","workspace_record_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "managed_identity_sessions_ws_record_id_idx" ON "managed_identity_sessions" USING btree ("workspace_record_id");
