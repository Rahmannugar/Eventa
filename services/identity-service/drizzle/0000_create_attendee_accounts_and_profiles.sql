CREATE TABLE "attendee_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendee_accounts_email_canonical" CHECK ("attendee_accounts"."email" = lower("attendee_accounts"."email"))
);
--> statement-breakpoint
CREATE TABLE "attendee_profiles" (
	"attendee_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendee_profiles_username_canonical" CHECK ("attendee_profiles"."username" ~ '^[a-z0-9_]{3,30}$')
);
--> statement-breakpoint
ALTER TABLE "attendee_profiles" ADD CONSTRAINT "attendee_profiles_attendee_id_attendee_accounts_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendee_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendee_accounts_email_unique" ON "attendee_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "attendee_profiles_username_unique" ON "attendee_profiles" USING btree ("username");
