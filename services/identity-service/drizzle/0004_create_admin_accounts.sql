CREATE TABLE "admin_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_accounts_email_canonical" CHECK ("admin_accounts"."email" = lower(btrim("admin_accounts"."email"))),
	CONSTRAINT "admin_accounts_activation_consistent" CHECK (("admin_accounts"."activated_at" IS NULL AND "admin_accounts"."password_hash" IS NULL) OR ("admin_accounts"."activated_at" IS NOT NULL AND "admin_accounts"."password_hash" IS NOT NULL AND "admin_accounts"."email_verified_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_accounts_email_unique" ON "admin_accounts" USING btree ("email");
