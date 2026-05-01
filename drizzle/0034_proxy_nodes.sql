CREATE TABLE "proxy_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tag" text NOT NULL,
	"protocol" text DEFAULT 'hysteria2' NOT NULL,
	"server" text NOT NULL,
	"server_port" integer NOT NULL,
	"username" text,
	"password_ciphertext" text,
	"password_preview" text,
	"tls_server_name" text,
	"tls_insecure" boolean DEFAULT false NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proxy_nodes" ADD CONSTRAINT "proxy_nodes_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_nodes_name_unique" ON "proxy_nodes" USING btree ("name");--> statement-breakpoint
CREATE INDEX "proxy_nodes_enabled_tag_idx" ON "proxy_nodes" USING btree ("enabled","tag");--> statement-breakpoint
CREATE INDEX "proxy_nodes_protocol_idx" ON "proxy_nodes" USING btree ("protocol");
