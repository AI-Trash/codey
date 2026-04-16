ALTER TABLE "managed_identities" ADD COLUMN "credential_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_identities" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "managed_identities" SET "last_seen_at" = "updated_at";
