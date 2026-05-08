ALTER TABLE "verification_domains" ADD COLUMN "mailbox_type" text DEFAULT 'cloudflare' NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_domains" RENAME COLUMN "enabled" TO "registration_enabled";--> statement-breakpoint
DROP INDEX IF EXISTS "verification_domains_enabled_domain_idx";--> statement-breakpoint
CREATE INDEX "verification_domains_registration_enabled_domain_idx" ON "verification_domains" USING btree ("registration_enabled","domain");
