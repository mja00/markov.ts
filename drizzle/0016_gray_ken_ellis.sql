CREATE TYPE "public"."memory_kind_enum" AS ENUM('PREFERENCE', 'FACT', 'QUOTE', 'REMINDER');--> statement-breakpoint
CREATE TABLE "automation_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" varchar(800) NOT NULL,
	"feature" varchar(100) NOT NULL,
	"target_snowflake" varchar(255) NOT NULL,
	"delivered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"message_snowflake" varchar(255) PRIMARY KEY NOT NULL,
	"guild_snowflake" varchar(255) NOT NULL,
	"channel_snowflake" varchar(255) NOT NULL,
	"author_snowflake" varchar(255) NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"reply_target_snowflake" varchar(255),
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"posted_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_snowflake" varchar(255) NOT NULL,
	"channel_snowflake" varchar(255) NOT NULL,
	"summary" text NOT NULL,
	"through_message_snowflake" varchar(255) NOT NULL,
	"message_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_assistant_preferences" (
	"guild_snowflake" varchar(255) PRIMARY KEY NOT NULL,
	"rare_catch_alerts" boolean DEFAULT false NOT NULL,
	"daily_fishing_quests" boolean DEFAULT false NOT NULL,
	"weekly_fishing_summaries" boolean DEFAULT false NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"quiet_hours_start" varchar(5),
	"quiet_hours_end" varchar(5),
	"destination_channel_snowflake" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_assistant_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preference_key" varchar(600) NOT NULL,
	"user_snowflake" varchar(255) NOT NULL,
	"guild_snowflake" varchar(255),
	"daily_fishing_quests" boolean DEFAULT false NOT NULL,
	"rare_catch_alerts" boolean DEFAULT false NOT NULL,
	"weekly_fishing_summaries" boolean DEFAULT false NOT NULL,
	"collection_reminders" boolean DEFAULT false NOT NULL,
	"personal_reminders" boolean DEFAULT false NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"quiet_hours_start" varchar(5),
	"quiet_hours_end" varchar(5),
	"frequency" varchar(32) DEFAULT 'weekly' NOT NULL,
	"destination_channel_snowflake" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "kind" "memory_kind_enum" DEFAULT 'FACT' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "confidence" numeric(4, 3) DEFAULT '0.750' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "importance" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "last_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "source_message_snowflake" varchar(255);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_deliveries_dedupe_idx" ON "automation_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "channel_messages_channel_time_idx" ON "channel_messages" USING btree ("guild_snowflake","channel_snowflake","posted_at");--> statement-breakpoint
CREATE INDEX "channel_messages_expires_idx" ON "channel_messages" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "conversation_summaries_channel_idx" ON "conversation_summaries" USING btree ("guild_snowflake","channel_snowflake","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_assistant_preferences_key_idx" ON "user_assistant_preferences" USING btree ("preference_key");