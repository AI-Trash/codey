ALTER TYPE "public"."verification_code_source" ADD VALUE 'WHATSAPP_NOTIFICATION';--> statement-breakpoint
CREATE TABLE "whatsapp_notification_ingest_records" (
	"id" text PRIMARY KEY NOT NULL,
	"reservation_id" text,
	"device_id" text,
	"notification_id" text,
	"package_name" text,
	"sender" text,
	"chat_name" text,
	"title" text,
	"body" text,
	"raw_payload" jsonb,
	"verification_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_notification_ingest_records" ADD CONSTRAINT "whatsapp_notification_ingest_records_reservation_id_verification_email_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."verification_email_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_notifications_reservation_received_at_idx" ON "whatsapp_notification_ingest_records" USING btree ("reservation_id","received_at");--> statement-breakpoint
CREATE INDEX "whatsapp_notifications_device_received_at_idx" ON "whatsapp_notification_ingest_records" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE INDEX "whatsapp_notifications_received_at_idx" ON "whatsapp_notification_ingest_records" USING btree ("received_at");
