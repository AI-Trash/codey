CREATE TABLE "managed_workspace_members" (
	"id" text PRIMARY KEY NOT NULL,
	"managed_workspace_id" text NOT NULL,
	"identity_id" text,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_workspace_members" ADD CONSTRAINT "managed_workspace_members_managed_workspace_id_managed_workspaces_id_fk" FOREIGN KEY ("managed_workspace_id") REFERENCES "public"."managed_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_workspace_members" ADD CONSTRAINT "managed_workspace_members_identity_id_managed_identities_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."managed_identities"("identity_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "managed_workspace_members_workspace_email_unique" ON "managed_workspace_members" USING btree ("managed_workspace_id","email");--> statement-breakpoint
CREATE INDEX "managed_workspace_members_identity_id_idx" ON "managed_workspace_members" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "managed_workspace_members_email_idx" ON "managed_workspace_members" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "managed_workspaces_workspace_id_unique" ON "managed_workspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "managed_workspaces_updated_at_idx" ON "managed_workspaces" USING btree ("updated_at");