/**
 * Script to populate slugs for existing items
 * Run this script after db:push to populate slugs for items that don't have them
 *
 * Usage: npm run build && node --enable-source-maps dist/scripts/populate-slugs.js
 */

import 'dotenv/config';

import { and, eq, isNull, ne } from 'drizzle-orm';

import { items } from '../db/schema.js';
import { DatabaseService } from '../services/database.service.js';
import { Logger } from '../services/logger.js';

/**
 * Generate slug from item name
 * @param name - The item name
 * @returns A sanitized slug
 * @throws Error if name is empty or invalid
 */
const generateSlug = (name: string): string => {
    if (!name?.trim()) {
        throw new Error('Cannot generate slug from empty name');
    }

    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Collapse multiple consecutive hyphens to single
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        .trim();
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
            let baseSlug = generateSlug(item.name);
            let slug = baseSlug;
            let counter = 1;

            // Handle slug conflicts by appending a counter
            let slugFound = false;
            while (!slugFound && counter <= 1000) {
                try {
                    // Check if slug already exists (excluding current item)
                    const existing = await db
                        .select()
                        .from(items)
                        .where(and(eq(items.slug, slug), ne(items.id, item.id)))
                        .limit(1);

                    if (existing.length === 0) {
                        // Slug is available, use it
                        slugFound = true;
                    } else {
                        // Slug exists, try with counter
                        slug = `${baseSlug}-${counter}`;
                        counter++;
                    }
                } catch (error) {
                    Logger.error(`[PopulateSlugs] Error checking slug uniqueness for "${item.name}":`, error);
                    // Fallback to item ID if check fails
                    slug = `${baseSlug}-${item.id.substring(0, 8)}`;
                    slugFound = true;
                }
            }

            // If we couldn't find a unique slug, use fallback
            if (!slugFound) {
                slug = `${baseSlug}-${item.id.substring(0, 8)}`;
                Logger.warn(
                    `[PopulateSlugs] Could not generate unique slug for "${item.name}", using fallback: "${slug}"`
                );
            }

            try {
                await db
                    .update(items)
                    .set({ slug: slug })
                    .where(eq(items.id, item.id));

                Logger.info(`[PopulateSlugs] Updated item "${item.name}" with slug "${slug}"`);
                updated++;
            } catch (error) {
                Logger.error(`[PopulateSlugs] Failed to update item "${item.name}" with slug "${slug}":`, error);
                // Continue with next item instead of failing completely
            }
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

