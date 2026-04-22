CREATE TYPE "public"."flow_task_status" AS ENUM('QUEUED', 'LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TABLE "flow_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"flow_type" text NOT NULL,
	"target" text,
	"cli_connection_id" text,
	"payload" jsonb NOT NULL,
	"status" "flow_task_status" DEFAULT 'QUEUED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cli_connections" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "flow_tasks" ADD CONSTRAINT "flow_tasks_cli_connection_id_cli_connections_id_fk" FOREIGN KEY ("cli_connection_id") REFERENCES "public"."cli_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_tasks_worker_status_created_at_idx" ON "flow_tasks" USING btree ("worker_id","status","created_at");--> statement-breakpoint
CREATE INDEX "flow_tasks_worker_lease_expires_at_idx" ON "flow_tasks" USING btree ("worker_id","lease_expires_at");--> statement-breakpoint
CREATE INDEX "flow_tasks_connection_status_idx" ON "flow_tasks" USING btree ("cli_connection_id","status");--> statement-breakpoint
CREATE INDEX "flow_tasks_status_updated_at_idx" ON "flow_tasks" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "cli_connections_worker_id_idx" ON "cli_connections" USING btree ("worker_id");