CREATE TYPE "public"."device_challenge_status" AS ENUM('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CONSUMED');--> statement-breakpoint
CREATE TYPE "public"."flow_app_request_status" AS ENUM('PENDING', 'IN_REVIEW', 'FULFILLED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."managed_identity_status" AS ENUM('ACTIVE', 'REVIEW', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('BROWSER', 'CLI');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'USER');--> statement-breakpoint
CREATE TYPE "public"."verification_code_source" AS ENUM('MANUAL', 'CLOUDFLARE_EMAIL');--> statement-breakpoint
CREATE TABLE "admin_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"flow_type" text,
	"target" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"status" "device_challenge_status" DEFAULT 'PENDING' NOT NULL,
	"scope" text,
	"flow_type" text,
	"cli_name" text,
	"requested_by" text,
	"approval_message" text,
	"access_token_hash" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"denied_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_ingest_records" (
	"id" text PRIMARY KEY NOT NULL,
	"reservation_id" text,
	"message_id" text,
	"recipient" text NOT NULL,
	"subject" text,
	"text_body" text,
	"html_body" text,
	"raw_payload" text,
	"verification_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_app_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"app_name" text NOT NULL,
	"flow_type" text,
	"requested_by" text,
	"requested_identity" text,
	"notes" text,
	"status" "flow_app_request_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"email" text NOT NULL,
	"label" text,
	"status" "managed_identity_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"kind" "session_kind" DEFAULT 'BROWSER' NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"github_id" text,
	"github_login" text,
	"name" text,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"reservation_id" text NOT NULL,
	"code" text NOT NULL,
	"source" "verification_code_source" NOT NULL,
	"message_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_email_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"prefix" text,
	"mailbox" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_challenges" ADD CONSTRAINT "device_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_ingest_records" ADD CONSTRAINT "email_ingest_records_reservation_id_verification_email_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."verification_email_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_reservation_id_verification_email_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."verification_email_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_challenges_device_code_unique" ON "device_challenges" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_challenges_user_code_unique" ON "device_challenges" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "email_ingest_records_recipient_received_at_idx" ON "email_ingest_records" USING btree ("recipient","received_at");--> statement-breakpoint
CREATE INDEX "flow_app_requests_created_at_idx" ON "flow_app_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "flow_app_requests_status_created_at_idx" ON "flow_app_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "managed_identities_identity_id_unique" ON "managed_identities" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "managed_identities_email_idx" ON "managed_identities" USING btree ("email");--> statement-breakpoint
CREATE INDEX "managed_identities_status_updated_at_idx" ON "managed_identities" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_github_id_unique" ON "users" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX "verification_codes_reservation_received_at_idx" ON "verification_codes" USING btree ("reservation_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_codes_reservation_code_received_at_unique" ON "verification_codes" USING btree ("reservation_id","code","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_email_reservations_email_unique" ON "verification_email_reservations" USING btree ("email");