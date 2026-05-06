CREATE TYPE "public"."mobile_device_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."mobile_phone_binding_purpose" AS ENUM('WHATSAPP', 'GOPAY', 'BOTH');--> statement-breakpoint
ALTER TABLE "device_challenges" ADD COLUMN "kind" text DEFAULT 'CLI' NOT NULL;--> statement-breakpoint
CREATE TABLE "mobile_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"label" text,
	"status" "mobile_device_status" DEFAULT 'ACTIVE' NOT NULL,
	"token_hash" text NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"paired_by_user_id" text,
	"device_challenge_id" text,
	"user_agent" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_devices_device_id_unique" UNIQUE("device_id"),
	CONSTRAINT "mobile_devices_token_hash_unique" UNIQUE("token_hash")
);--> statement-breakpoint
CREATE TABLE "mobile_phone_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"mobile_device_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"country_code" text,
	"purpose" "mobile_phone_binding_purpose" DEFAULT 'WHATSAPP' NOT NULL,
	"label" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_phone_bindings_device_phone_purpose_unique" UNIQUE("mobile_device_id","phone_number","purpose")
);--> statement-breakpoint
ALTER TABLE "whatsapp_notification_ingest_records" ADD COLUMN "mobile_device_id" text;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_paired_by_user_id_users_id_fk" FOREIGN KEY ("paired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_device_challenge_id_device_challenges_id_fk" FOREIGN KEY ("device_challenge_id") REFERENCES "public"."device_challenges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_phone_bindings" ADD CONSTRAINT "mobile_phone_bindings_mobile_device_id_mobile_devices_id_fk" FOREIGN KEY ("mobile_device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_notification_ingest_records" ADD CONSTRAINT "whatsapp_notification_ingest_records_mobile_device_id_mobile_devices_id_fk" FOREIGN KEY ("mobile_device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_devices_status_last_seen_at_idx" ON "mobile_devices" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "mobile_devices_paired_by_user_idx" ON "mobile_devices" USING btree ("paired_by_user_id");--> statement-breakpoint
CREATE INDEX "mobile_phone_bindings_device_purpose_idx" ON "mobile_phone_bindings" USING btree ("mobile_device_id","purpose");--> statement-breakpoint
CREATE INDEX "mobile_phone_bindings_phone_purpose_idx" ON "mobile_phone_bindings" USING btree ("phone_number","purpose");
