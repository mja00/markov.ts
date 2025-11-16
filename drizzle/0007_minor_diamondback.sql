CREATE TYPE "public"."time_of_day_enum" AS ENUM('DAY', 'NIGHT', 'DAWN', 'DUSK', 'ANY');--> statement-breakpoint
ALTER TABLE "catchables" ADD COLUMN "time_of_day" time_of_day_enum DEFAULT 'ANY';
