CREATE TYPE "public"."managed_identity_plan" AS ENUM('free', 'plus', 'team');--> statement-breakpoint
ALTER TABLE "managed_identities" ADD COLUMN "plan" "managed_identity_plan" DEFAULT 'free' NOT NULL;
--> statement-breakpoint
UPDATE "managed_identity_sessions"
SET "status" = 'ACTIVE'
WHERE "status" = 'REVOKED';
