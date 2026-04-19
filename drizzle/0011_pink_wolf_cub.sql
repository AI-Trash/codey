ALTER TABLE "admin_notifications" ADD COLUMN "kind" text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD COLUMN "cli_connection_id" text;--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "registered_flows" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_cli_connection_id_cli_connections_id_fk" FOREIGN KEY ("cli_connection_id") REFERENCES "public"."cli_connections"("id") ON DELETE set null ON UPDATE no action;