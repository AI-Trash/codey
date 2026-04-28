ALTER TYPE "public"."external_service_kind" ADD VALUE 'astrbot';--> statement-breakpoint
ALTER TABLE "external_service_configs" ADD COLUMN "settings" jsonb;
