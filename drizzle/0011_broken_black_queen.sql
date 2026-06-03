CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."memory_scope_enum" AS ENUM('USER', 'SERVER', 'QUOTE');--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "memory_scope_enum" NOT NULL,
	"user_snowflake" varchar(255),
	"guild_snowflake" varchar(255),
	"content" text NOT NULL,
	"embedding" vector(1536),
	"source_channel_snowflake" varchar(255),
	"created_by_model" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "memories_guild_idx" ON "memories" USING btree ("guild_snowflake");--> statement-breakpoint
CREATE INDEX "memories_user_guild_idx" ON "memories" USING btree ("user_snowflake","guild_snowflake");--> statement-breakpoint
CREATE INDEX "memories_embedding_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);