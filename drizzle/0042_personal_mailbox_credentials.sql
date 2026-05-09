ALTER TYPE "verification_code_source" ADD VALUE IF NOT EXISTS 'OUTLOOK_GRAPH';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_mailbox_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_domain_id" text NOT NULL,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_mailbox_credentials_verification_domain_id_verification_domains_id_fk" FOREIGN KEY ("verification_domain_id") REFERENCES "public"."verification_domains"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_mailbox_credentials_domain_unique" ON "personal_mailbox_credentials" USING btree ("verification_domain_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_mailbox_credentials_provider_idx" ON "personal_mailbox_credentials" USING btree ("provider");
