CREATE TYPE "public"."flow_task_event_type" AS ENUM('QUEUED', 'LEASED', 'RUNNING', 'LOG', 'SUCCEEDED', 'FAILED', 'CANCELED');--> statement-breakpoint
ALTER TABLE "flow_tasks" ADD COLUMN "last_message" text;--> statement-breakpoint
CREATE TABLE "flow_task_events" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"cli_connection_id" text,
	"type" "flow_task_event_type" NOT NULL,
	"status" "flow_task_status",
	"message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_task_events" ADD CONSTRAINT "flow_task_events_task_id_flow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."flow_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_task_events" ADD CONSTRAINT "flow_task_events_cli_connection_id_cli_connections_id_fk" FOREIGN KEY ("cli_connection_id") REFERENCES "public"."cli_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_task_events_task_created_at_idx" ON "flow_task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_task_events_connection_created_at_idx" ON "flow_task_events" USING btree ("cli_connection_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_task_events_type_created_at_idx" ON "flow_task_events" USING btree ("type","created_at");
