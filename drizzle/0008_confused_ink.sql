ALTER TABLE "managed_identities" ADD COLUMN "password_ciphertext" text;--> statement-breakpoint
ALTER TABLE "managed_identities" ADD COLUMN "credential_metadata" jsonb;