import { and, eq, isNull, sql } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { Catchable, catchables, catches, CatchInsert } from '../db/schema.js';

/**
 * Rarity levels for catchables
 */
export enum Rarity {
    COMMON = 0,
    UNCOMMON = 1,
    RARE = 2,
    LEGENDARY = 3,
}

/**
 * Rarity weights for random selection
 * Total weight: 100
 */
const RARITY_WEIGHTS = {
    [Rarity.COMMON]: 60, // 60%
    [Rarity.UNCOMMON]: 30, // 30%
    [Rarity.RARE]: 8, // 8%
    [Rarity.LEGENDARY]: 2, // 2%
};

/**
 * Service for managing fishing operations
 */
export class FishingService {
    /**
     * Determine rarity based on weighted random selection
     * @returns The selected rarity level
     */
    public determineRarity(): Rarity {
        const random = Math.random() * 100;
        let cumulative = 0;

        // Iterate through rarities from highest to lowest
        for (const rarity of [Rarity.LEGENDARY, Rarity.RARE, Rarity.UNCOMMON, Rarity.COMMON]) {
            cumulative += RARITY_WEIGHTS[rarity];
            if (random < cumulative) {
                return rarity;
            }
        }

        // Fallback to common (should never reach here)
        return Rarity.COMMON;
    }

    /**
     * Pick a random catchable by rarity
     * @param rarity - The rarity level to pick from
     * @returns A random catchable of the specified rarity, or null if none found
     */
    public async pickCatchableByRarity(rarity: Rarity): Promise<Catchable | null> {
        const db = getDb();

        try {
            // Get all catchables of this rarity
            const availableCatchables = await db
                .select()
                .from(catchables)
                .where(eq(catchables.rarity, rarity));

            if (availableCatchables.length === 0) {
                Logger.warn(`[FishingService] No catchables found for rarity ${rarity}`);
                return null;
            }

            // Pick a random one
            const randomIndex = Math.floor(Math.random() * availableCatchables.length);
            return availableCatchables[randomIndex];
        } catch (error) {
            Logger.error(`[FishingService] Failed to pick catchable by rarity ${rarity}:`, error);
            throw new Error(`Failed to pick catchable: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check if this is the first time a catchable has been caught
     * @param catchableId - The catchable UUID
     * @returns true if this is the first catch, false otherwise
     */
    public async isFirstCatch(catchableId: string): Promise<boolean> {
        const db = getDb();

        try {
            const catchable = await db
                .select()
                .from(catchables)
                .where(and(eq(catchables.id, catchableId), isNull(catchables.firstCaughtBy)))
                .limit(1);

            return catchable.length > 0;
        } catch (error) {
            Logger.error(`[FishingService] Failed to check first catch for ${catchableId}:`, error);
            throw new Error(`Failed to check first catch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Mark a catchable as first caught by a user
     * @param catchableId - The catchable UUID
     * @param userId - The user UUID
     * @returns The updated catchable
     */
    public async markFirstCatch(catchableId: string, userId: string): Promise<Catchable> {
        const db = getDb();

        try {
            const updated = await db
                .update(catchables)
                .set({
                    firstCaughtBy: userId,
                    updatedAt: new Date(),
                })
                .where(and(eq(catchables.id, catchableId), isNull(catchables.firstCaughtBy)))
                .returning();

            if (updated.length === 0) {
                throw new Error('Catchable already has a first catch or does not exist');
            }

            Logger.info(`[FishingService] Marked first catch of ${catchableId} by user ${userId}`);
            return updated[0];
        } catch (error) {
            Logger.error(`[FishingService] Failed to mark first catch for ${catchableId}:`, error);
            throw new Error(`Failed to mark first catch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Add a catch record to the database
     * @param userId - The user UUID
     * @param catchableId - The catchable UUID
     * @returns The created catch record
     */
    public async addCatch(userId: string, catchableId: string): Promise<CatchInsert> {
        const db = getDb();

        try {
            const newCatch: CatchInsert = {
                caughtBy: userId,
                catchableId: catchableId,
            };

            const created = await db.insert(catches).values(newCatch).returning();

            Logger.debug(`[FishingService] Added catch of ${catchableId} by user ${userId}`);
            return created[0];
        } catch (error) {
            Logger.error(`[FishingService] Failed to add catch for user ${userId}:`, error);
            throw new Error(`Failed to add catch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get all catchables
     * @returns Array of all catchables
     */
    public async getAllCatchables(): Promise<Catchable[]> {
        const db = getDb();

        try {
            return await db.select().from(catchables);
        } catch (error) {
            Logger.error('[FishingService] Failed to get all catchables:', error);
            throw new Error(`Failed to get catchables: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a catchable by ID
     * @param catchableId - The catchable UUID
     * @returns The catchable or null if not found
     */
    public async getCatchableById(catchableId: string): Promise<Catchable | null> {
        const db = getDb();

        try {
            const result = await db.select().from(catchables).where(eq(catchables.id, catchableId)).limit(1);

            return result[0] || null;
        } catch (error) {
            Logger.error(`[FishingService] Failed to get catchable ${catchableId}:`, error);
            throw new Error(`Failed to get catchable: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get user's catch history
     * @param userId - The user UUID
     * @param limit - Maximum number of catches to return
     * @returns Array of catches with catchable details
     */
    public async getUserCatchHistory(
        userId: string,
        limit: number = 10,
    ): Promise<Array<{ catch: CatchInsert; catchable: Catchable }>> {
        const db = getDb();

        try {
            const result = await db
                .select({
                    catch: catches,
                    catchable: catchables,
                })
                .from(catches)
                .innerJoin(catchables, eq(catches.catchableId, catchables.id))
                .where(eq(catches.caughtBy, userId))
                .orderBy(sql`${catches.createdAt} DESC`)
                .limit(limit);

            return result;
        } catch (error) {
            Logger.error(`[FishingService] Failed to get catch history for user ${userId}:`, error);
            throw new Error(`Failed to get catch history: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get catchable statistics
     * @param catchableId - The catchable UUID
     * @returns Statistics about the catchable
     */
    public async getCatchableStats(catchableId: string): Promise<{
        totalCatches: number;
        firstCaughtBy: string | null;
        catchable: Catchable;
    }> {
        const db = getDb();

        try {
            // Get the catchable
            const catchable = await this.getCatchableById(catchableId);

            if (!catchable) {
                throw new Error(`Catchable ${catchableId} not found`);
            }

            // Get total catches
            const totalCatchesResult = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(catches)
                .where(eq(catches.catchableId, catchableId));

            const totalCatches = totalCatchesResult[0]?.count || 0;

            return {
                totalCatches,
                firstCaughtBy: catchable.firstCaughtBy,
                catchable,
            };
        } catch (error) {
            Logger.error(`[FishingService] Failed to get catchable stats for ${catchableId}:`, error);
            throw new Error(`Failed to get catchable stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get rarity name as string
     * @param rarity - Rarity enum value
     * @returns Rarity name
     */
    public getRarityName(rarity: Rarity): string {
        switch (rarity) {
            case Rarity.COMMON:
                return 'Common';
            case Rarity.UNCOMMON:
                return 'Uncommon';
            case Rarity.RARE:
                return 'Rare';
            case Rarity.LEGENDARY:
                return 'Legendary';
            default:
                return 'Unknown';
        }
    }

    /**
     * Get rarity color for Discord embeds
     * @param rarity - Rarity enum value
     * @returns Hex color code
     */
    public getRarityColor(rarity: Rarity): number {
        switch (rarity) {
            case Rarity.COMMON:
                return 0x95a5a6; // Gray
            case Rarity.UNCOMMON:
                return 0x2ecc71; // Green
            case Rarity.RARE:
                return 0x3498db; // Blue
            case Rarity.LEGENDARY:
                return 0xf39c12; // Gold
            default:
                return 0x000000; // Black
        }
    }
}
