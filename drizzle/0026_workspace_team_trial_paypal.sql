ALTER TABLE "managed_workspaces" ADD COLUMN "team_trial_paypal_url" text;--> statement-breakpoint
ALTER TABLE "managed_workspaces" ADD COLUMN "team_trial_paypal_captured_at" timestamp with time zone;
