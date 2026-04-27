CREATE TABLE "workspace_invite_authorize_workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"managed_workspace_id" text NOT NULL,
	"connection_id" text,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"phase" text DEFAULT 'MEMBER_LOGIN' NOT NULL,
	"target_member_count" integer DEFAULT 9 NOT NULL,
	"last_message" text,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_invite_authorize_workflows" ADD CONSTRAINT "workspace_invite_authorize_workflows_managed_workspace_id_managed_workspaces_id_fk" FOREIGN KEY ("managed_workspace_id") REFERENCES "public"."managed_workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_invite_authorize_workflows_workspace_idx" ON "workspace_invite_authorize_workflows" USING btree ("managed_workspace_id");
--> statement-breakpoint
CREATE INDEX "workspace_invite_authorize_workflows_status_updated_idx" ON "workspace_invite_authorize_workflows" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE INDEX "workspace_invite_authorize_workflows_connection_idx" ON "workspace_invite_authorize_workflows" USING btree ("connection_id");
