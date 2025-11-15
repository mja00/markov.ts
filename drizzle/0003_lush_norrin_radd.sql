CREATE TYPE "public"."effect_type_enum" AS ENUM('RARITY_BOOST', 'WORTH_MULTIPLIER');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "effect_type" "effect_type_enum";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "effect_value" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_consumable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_passive" boolean DEFAULT false NOT NULL;