/**
 * Script to populate slugs for existing items
 * Run this script after db:push to populate slugs for items that don't have them
 *
 * Usage: npm run build && node --enable-source-maps dist/scripts/populate-slugs.js
 */

import 'dotenv/config';

import { eq, isNull } from 'drizzle-orm';

import { items } from '../db/schema.js';
import { DatabaseService } from '../services/database.service.js';
import { Logger } from '../services/logger.js';

/**
 * Generate slug from item name
 */
const generateSlug = (name: string): string => {
    return name.toLowerCase().replace(/\s+/g, '-');
};

/**
 * Populate slugs for items that don't have them
 */
const populateSlugs = async (): Promise<void> => {
    Logger.info('[PopulateSlugs] Starting slug population...');

    try {
        // Connect to database
        await DatabaseService.getInstance().connect();
        const db = DatabaseService.getInstance().getDb();

        // Get all items without slugs
        const itemsWithoutSlugs = await db
            .select()
            .from(items)
            .where(isNull(items.slug));

        Logger.info(`[PopulateSlugs] Found ${itemsWithoutSlugs.length} items without slugs`);

        if (itemsWithoutSlugs.length === 0) {
            Logger.info('[PopulateSlugs] All items already have slugs. Nothing to do.');
            return;
        }

        // Update each item with a slug
        let updated = 0;
        for (const item of itemsWithoutSlugs) {
            const slug = generateSlug(item.name);

            await db
                .update(items)
                .set({ slug: slug })
                .where(eq(items.id, item.id));

            Logger.info(`[PopulateSlugs] Updated item "${item.name}" with slug "${slug}"`);
            updated++;
        }

        Logger.info(`[PopulateSlugs] ✅ Successfully populated ${updated} slugs!`);
    } catch (error) {
        Logger.error('[PopulateSlugs] Failed to populate slugs:', error);
        process.exit(1);
    } finally {
        // Disconnect from database
        await DatabaseService.getInstance().disconnect();
    }
};

// Run slug population
populateSlugs();

