ALTER TABLE "flow_tasks" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flow_tasks" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
CREATE TABLE "flow_task_default_configs" (
	"flow_type" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "flow_task_default_configs" ADD CONSTRAINT "flow_task_default_configs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
