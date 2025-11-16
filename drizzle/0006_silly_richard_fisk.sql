ALTER TABLE "shop" DROP CONSTRAINT "shop_slug_unique";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "slug" varchar(255);--> statement-breakpoint
ALTER TABLE "shop" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_slug_unique" UNIQUE("slug");
