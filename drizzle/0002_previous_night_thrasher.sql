CREATE TABLE "oidc_signing_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"kid" text NOT NULL,
	"algorithm" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_jwk" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotates_at" timestamp with time zone NOT NULL,
	"retires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_signing_keys_kid_unique" ON "oidc_signing_keys" USING btree ("kid");--> statement-breakpoint
CREATE INDEX "oidc_signing_keys_active_rotates_at_idx" ON "oidc_signing_keys" USING btree ("is_active","rotates_at");--> statement-breakpoint
CREATE INDEX "oidc_signing_keys_retires_at_idx" ON "oidc_signing_keys" USING btree ("retires_at");