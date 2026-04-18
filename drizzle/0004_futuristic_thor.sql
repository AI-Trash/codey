CREATE TABLE "verification_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "verification_domain_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_domains_domain_unique" ON "verification_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "verification_domains_default_idx" ON "verification_domains" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "verification_domains_enabled_domain_idx" ON "verification_domains" USING btree ("enabled","domain");--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_verification_domain_id_verification_domains_id_fk" FOREIGN KEY ("verification_domain_id") REFERENCES "public"."verification_domains"("id") ON DELETE set null ON UPDATE no action;