ALTER TYPE "public"."external_service_auth_mode" ADD VALUE 'api_key' BEFORE 'bearer_token';--> statement-breakpoint
ALTER TABLE "external_service_configs" ADD COLUMN "api_key_ciphertext" text;
