CREATE TYPE "public"."managed_identity_session_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TABLE "managed_identity_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"email" text NOT NULL,
	"auth_mode" text NOT NULL,
	"flow_type" text NOT NULL,
	"account_id" text,
	"session_id" text,
	"session_data" jsonb NOT NULL,
	"status" "managed_identity_session_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_refresh_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_identity_sessions" ADD CONSTRAINT "managed_identity_sessions_identity_id_managed_identities_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."managed_identities"("identity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "managed_identity_sessions_identity_id_unique" ON "managed_identity_sessions" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "managed_identity_sessions_status_last_seen_at_idx" ON "managed_identity_sessions" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "managed_identity_sessions_email_idx" ON "managed_identity_sessions" USING btree ("email");--> statement-breakpoint
CREATE INDEX "managed_identity_sessions_account_id_idx" ON "managed_identity_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "managed_identity_sessions_session_id_idx" ON "managed_identity_sessions" USING btree ("session_id");