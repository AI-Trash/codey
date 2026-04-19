CREATE TABLE "cli_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"session_ref" text,
	"user_id" text,
	"auth_client_id" text,
	"cli_name" text,
	"target" text,
	"user_agent" text,
	"connection_path" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "users"
SET "permissions" = ARRAY['OPERATIONS', 'OAUTH_APPS', 'USERS']::text[]
WHERE "role" = 'ADMIN';
--> statement-breakpoint
ALTER TABLE "cli_connections" ADD CONSTRAINT "cli_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cli_connections_last_seen_at_idx" ON "cli_connections" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "cli_connections_user_id_idx" ON "cli_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cli_connections_session_ref_idx" ON "cli_connections" USING btree ("session_ref");--> statement-breakpoint
CREATE INDEX "cli_connections_auth_client_id_idx" ON "cli_connections" USING btree ("auth_client_id");--> statement-breakpoint
CREATE INDEX "cli_connections_connected_at_idx" ON "cli_connections" USING btree ("connected_at");
