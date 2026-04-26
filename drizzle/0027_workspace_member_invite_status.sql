ALTER TABLE "managed_workspace_members" ADD COLUMN "invite_status" text DEFAULT 'NOT_INVITED' NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_workspace_members" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "managed_workspace_members" ADD COLUMN "invite_status_updated_at" timestamp with time zone DEFAULT now() NOT NULL;
