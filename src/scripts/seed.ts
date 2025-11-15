/**
 * Database seeding script for fishing game
 * Run this script to populate the database with initial data
 *
 * Usage: npm run build && node dist/scripts/seed.js
 */

import 'dotenv/config';

import { catchables, items, shop } from '../db/schema.js';
import { DatabaseService } from '../services/database.service.js';
import { Rarity } from '../services/fishing.service.js';
import { Logger } from '../services/logger.js';

/**
 * Seed catchables data
 * Distribution: Common (60%), Uncommon (30%), Rare (8%), Legendary (2%)
 */
const seedCatchables = async (): Promise<void> => {
    const db = DatabaseService.getInstance().getDb();

    Logger.info('[DatabaseSeed] Seeding catchables...');

    const catchablesData = [
        // Common (60%) - Rarity 0
        { name: 'Minnow', rarity: Rarity.COMMON, worth: 5, image: null },
        { name: 'Sardine', rarity: Rarity.COMMON, worth: 8, image: null },
        { name: 'Crab', rarity: Rarity.COMMON, worth: 10, image: null },
        { name: 'Seaweed', rarity: Rarity.COMMON, worth: 3, image: null },
        { name: 'Clam', rarity: Rarity.COMMON, worth: 7, image: null },
        { name: 'Shrimp', rarity: Rarity.COMMON, worth: 6, image: null },
        { name: 'Anchovy', rarity: Rarity.COMMON, worth: 5, image: null },
        { name: 'Oyster', rarity: Rarity.COMMON, worth: 9, image: null },

        // Uncommon (30%) - Rarity 1
        { name: 'Bass', rarity: Rarity.UNCOMMON, worth: 25, image: null },
        { name: 'Salmon', rarity: Rarity.UNCOMMON, worth: 30, image: null },
        { name: 'Trout', rarity: Rarity.UNCOMMON, worth: 28, image: null },
        { name: 'Octopus', rarity: Rarity.UNCOMMON, worth: 35, image: null },
        { name: 'Lobster', rarity: Rarity.UNCOMMON, worth: 40, image: null },
        { name: 'Mackerel', rarity: Rarity.UNCOMMON, worth: 22, image: null },

        // Rare (8%) - Rarity 2
        { name: 'Tuna', rarity: Rarity.RARE, worth: 100, image: null },
        { name: 'Swordfish', rarity: Rarity.RARE, worth: 150, image: null },
        { name: 'Manta Ray', rarity: Rarity.RARE, worth: 120, image: null },
        { name: 'Giant Squid', rarity: Rarity.RARE, worth: 180, image: null },
        { name: 'Treasure Chest', rarity: Rarity.RARE, worth: 200, image: null },

        // Legendary (2%) - Rarity 3
        { name: 'Great White Shark', rarity: Rarity.LEGENDARY, worth: 500, image: null },
        { name: 'Megalodon', rarity: Rarity.LEGENDARY, worth: 1000, image: null },
        { name: 'Kraken', rarity: Rarity.LEGENDARY, worth: 2000, image: null },
        { name: 'Golden Fish', rarity: Rarity.LEGENDARY, worth: 1500, image: null },
    ];

    try {
        await db.insert(catchables).values(catchablesData);
        Logger.info(`[DatabaseSeed] Seeded ${catchablesData.length} catchables`);
    } catch (error) {
        Logger.error('[DatabaseSeed] Error seeding catchables:', error);
        throw error;
    }
};

/**
 * Seed shop items
 */
const seedShopItems = async (): Promise<void> => {
    const db = DatabaseService.getInstance().getDb();

    Logger.info('[DatabaseSeed] Seeding shop items...');

    // First, create items
    const itemsData = [
        { name: 'Basic Bait', image: null },
        { name: 'Premium Bait', image: null },
        { name: 'Lucky Charm', image: null },
        { name: 'Fishing Rod Upgrade', image: null },
        { name: 'Deep Sea Lure', image: null },
        { name: 'Golden Hook', image: null },
        { name: 'Sonar Device', image: null },
        { name: 'Auto Fisher', image: null },
    ];

    try {
        const createdItems = await db.insert(items).values(itemsData).returning();
        Logger.info(`[DatabaseSeed] Seeded ${createdItems.length} items`);

        // Create shop entries for each item
        const shopData = [
            { itemId: createdItems[0].id, cost: 50 }, // Basic Bait
            { itemId: createdItems[1].id, cost: 150 }, // Premium Bait
            { itemId: createdItems[2].id, cost: 200 }, // Lucky Charm
            { itemId: createdItems[3].id, cost: 500 }, // Fishing Rod Upgrade
            { itemId: createdItems[4].id, cost: 300 }, // Deep Sea Lure
            { itemId: createdItems[5].id, cost: 1000 }, // Golden Hook
            { itemId: createdItems[6].id, cost: 800 }, // Sonar Device
            { itemId: createdItems[7].id, cost: 2500 }, // Auto Fisher
        ];

        await db.insert(shop).values(shopData);
        Logger.info(`[DatabaseSeed] Seeded ${shopData.length} shop entries`);
    } catch (error) {
        Logger.error('[DatabaseSeed] Error seeding shop items:', error);
        throw error;
    }
};

/**
 * Main seeding function
 */
const seed = async (): Promise<void> => {
    Logger.info('[DatabaseSeed] Starting database seeding...');

    try {
        // Connect to database
        await DatabaseService.getInstance().connect();

        // Seed data
        await seedCatchables();
        await seedShopItems();

        Logger.info('[DatabaseSeed] Database seeding completed successfully!');
    } catch (error) {
        Logger.error('[DatabaseSeed] Database seeding failed:', error);
        process.exit(1);
    } finally {
        // Disconnect from database
        await DatabaseService.getInstance().disconnect();
    }
};

// Run seeding
seed();
