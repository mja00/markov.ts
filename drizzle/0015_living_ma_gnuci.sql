CREATE TYPE "public"."conversation_context_type_enum" AS ENUM('PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TABLE "conversation_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_key" varchar(800) NOT NULL,
	"type" "conversation_context_type_enum" NOT NULL,
	"guild_snowflake" varchar(255),
	"channel_snowflake" varchar(255) NOT NULL,
	"user_snowflake" varchar(255),
	"last_response_id" varchar(255),
	"message_count" integer DEFAULT 0 NOT NULL,
	"public_summary" text,
	"expires_at" timestamp NOT NULL,
	"lock_token" uuid,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_contexts_key_idx" ON "conversation_contexts" USING btree ("context_key");--> statement-breakpoint
CREATE INDEX "conversation_contexts_expiry_idx" ON "conversation_contexts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "conversation_contexts_channel_idx" ON "conversation_contexts" USING btree ("guild_snowflake","channel_snowflake");