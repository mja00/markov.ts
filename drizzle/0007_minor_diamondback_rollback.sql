-- Rollback migration for 0007_minor_diamondback
-- This removes the time_of_day column and enum type
-- WARNING: This will delete all time-based fishing configuration data

ALTER TABLE "catchables" DROP COLUMN "time_of_day";--> statement-breakpoint
DROP TYPE "public"."time_of_day_enum";
