ALTER TABLE "shop" ADD COLUMN "slug" varchar(255);--> statement-breakpoint
ALTER TABLE "shop" ADD CONSTRAINT "shop_slug_unique" UNIQUE("slug");
