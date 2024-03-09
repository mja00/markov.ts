CREATE TABLE IF NOT EXISTS "catchables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"rarity" integer DEFAULT 0 NOT NULL,
	"worth" integer DEFAULT 0 NOT NULL,
	"image" varchar(255),
	"first_caught_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"catchable_id" uuid,
	"caught_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"discord_snowflake" varchar(255) NOT NULL,
	"money" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_discord_snowflake_unique" UNIQUE("discord_snowflake")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catchables" ADD CONSTRAINT "catchables_first_caught_by_users_id_fk" FOREIGN KEY ("first_caught_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catches" ADD CONSTRAINT "catches_catchable_id_catchables_id_fk" FOREIGN KEY ("catchable_id") REFERENCES "catchables"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catches" ADD CONSTRAINT "catches_caught_by_users_id_fk" FOREIGN KEY ("caught_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
