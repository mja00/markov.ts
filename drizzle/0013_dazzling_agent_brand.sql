CREATE TYPE "public"."scheduled_message_status_enum" AS ENUM('PENDING', 'SENT', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_snowflake" varchar(255) NOT NULL,
	"guild_snowflake" varchar(255),
	"created_by_snowflake" varchar(255),
	"content" text NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"status" "scheduled_message_status_enum" DEFAULT 'PENDING' NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scheduled_messages_due_idx" ON "scheduled_messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "scheduled_messages_channel_idx" ON "scheduled_messages" USING btree ("channel_snowflake","status");