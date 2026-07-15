-- Existing rows are verbatim raw transcripts (the privacy defect this release fixes),
-- so purge them rather than backfilling an expiry onto leaked content. Emptying the
-- table also lets the NOT NULL column add succeed without a default.
DELETE FROM "conversation_summaries";--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD COLUMN "expires_at" timestamp NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_summaries_expires_idx" ON "conversation_summaries" USING btree ("expires_at");