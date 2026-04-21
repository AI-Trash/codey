CREATE TYPE "public"."external_service_auth_mode" AS ENUM('bearer_token', 'password');--> statement-breakpoint
CREATE TYPE "public"."external_service_kind" AS ENUM('sub2api');--> statement-breakpoint
CREATE TABLE "external_service_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "external_service_kind" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"base_url" text,
	"auth_mode" "external_service_auth_mode",
	"bearer_token_ciphertext" text,
	"email" text,
	"password_ciphertext" text,
	"login_path" text,
	"refresh_token_path" text,
	"accounts_path" text,
	"client_id" text,
	"proxy_id" integer,
	"concurrency" integer,
	"priority" integer,
	"group_ids" integer[],
	"confirm_mixed_channel_risk" boolean,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_service_configs" ADD CONSTRAINT "external_service_configs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_service_configs_kind_unique" ON "external_service_configs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "external_service_configs_enabled_kind_idx" ON "external_service_configs" USING btree ("enabled","kind");