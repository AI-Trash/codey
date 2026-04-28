CREATE TABLE "identity_maintenance_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "identity_id" text NOT NULL,
  "email" text NOT NULL,
  "flow_task_id" text,
  "cli_connection_id" text,
  "worker_id" text NOT NULL,
  "status" "flow_task_status" DEFAULT 'QUEUED' NOT NULL,
  "last_message" text,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "identity_maintenance_runs" ADD CONSTRAINT "identity_maintenance_runs_identity_id_managed_identities_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."managed_identities"("identity_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "identity_maintenance_runs" ADD CONSTRAINT "identity_maintenance_runs_flow_task_id_flow_tasks_id_fk" FOREIGN KEY ("flow_task_id") REFERENCES "public"."flow_tasks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "identity_maintenance_runs" ADD CONSTRAINT "identity_maintenance_runs_cli_connection_id_cli_connections_id_fk" FOREIGN KEY ("cli_connection_id") REFERENCES "public"."cli_connections"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_maintenance_runs_flow_task_unique" ON "identity_maintenance_runs" USING btree ("flow_task_id");
--> statement-breakpoint
CREATE INDEX "identity_maintenance_runs_identity_status_updated_idx" ON "identity_maintenance_runs" USING btree ("identity_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX "identity_maintenance_runs_worker_status_idx" ON "identity_maintenance_runs" USING btree ("worker_id","status");
--> statement-breakpoint
CREATE INDEX "identity_maintenance_runs_created_at_idx" ON "identity_maintenance_runs" USING btree ("created_at");
