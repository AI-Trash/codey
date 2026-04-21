ALTER TABLE "cli_connections" ADD COLUMN "runtime_flow_id" text;--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "runtime_task_id" text;--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "runtime_flow_status" text;--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "runtime_flow_message" text;--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "runtime_flow_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "runtime_flow_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "runtime_flow_updated_at" timestamp with time zone;