CREATE TYPE "public"."oauth_client_auth_method" AS ENUM('client_secret_basic', 'client_secret_post');--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"client_credentials_enabled" boolean DEFAULT false NOT NULL,
	"device_flow_enabled" boolean DEFAULT false NOT NULL,
	"token_endpoint_auth_method" "oauth_client_auth_method" DEFAULT 'client_secret_basic' NOT NULL,
	"client_secret_ciphertext" text NOT NULL,
	"client_secret_preview" text NOT NULL,
	"allowed_scopes" text DEFAULT '' NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"client_secret_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_artifacts" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"artifact_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" text,
	"user_code" text,
	"uid" text,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_clients_client_id_unique" ON "oauth_clients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_clients_enabled_updated_at_idx" ON "oauth_clients" USING btree ("enabled","updated_at");--> statement-breakpoint
CREATE INDEX "oauth_clients_created_at_idx" ON "oauth_clients" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_artifacts_kind_artifact_id_unique" ON "oidc_artifacts" USING btree ("kind","artifact_id");--> statement-breakpoint
CREATE INDEX "oidc_artifacts_kind_grant_id_idx" ON "oidc_artifacts" USING btree ("kind","grant_id");--> statement-breakpoint
CREATE INDEX "oidc_artifacts_kind_user_code_idx" ON "oidc_artifacts" USING btree ("kind","user_code");--> statement-breakpoint
CREATE INDEX "oidc_artifacts_kind_uid_idx" ON "oidc_artifacts" USING btree ("kind","uid");--> statement-breakpoint
CREATE INDEX "oidc_artifacts_expires_at_idx" ON "oidc_artifacts" USING btree ("expires_at");