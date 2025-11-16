import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { ItemEffectsService } from './item-effects.service.js';
import { Logger } from './logger.js';
import { Catchable, catchables, catches, CatchInsert } from '../db/schema.js';
import { Rarity } from '../enums/rarity.js';
import { TimeOfDay } from '../enums/time-of-day.js';

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
 * Time of day hour boundaries (24-hour format, UTC)
 * These define when each time period starts/ends
 */
const TIME_BOUNDARIES = {
    DAWN_START: 5,
    DAWN_END: 7,
    DAY_END: 18,
    DUSK_END: 20,
} as const;

/**
 * Service for managing fishing operations
 */
export class FishingService {
    public readonly itemEffectsService: ItemEffectsService;

    constructor() {
        this.itemEffectsService = new ItemEffectsService();
    }

    /**
     * Determine the current time of day based on the hour (24-hour format)
     * Uses UTC timezone for consistency across all users.
     *
     * Time periods (exclusive upper bounds):
     * - Dawn: 5-7 UTC (5:00-6:59) - hours 5, 6
     * - Day: 7-18 UTC (7:00-17:59) - hours 7-17
     * - Dusk: 18-20 UTC (18:00-19:59) - hours 18, 19
     * - Night: 20-5 UTC (20:00-4:59) - hours 20-23, 0-4
     *
     * @param hour - Optional hour to check (defaults to current hour in UTC)
     * @returns The time of day enum value
     */
    public getCurrentTimeOfDay(hour?: number): TimeOfDay {
        const currentHour = hour ?? new Date().getUTCHours();

        // Dawn: 5-7 UTC (5:00-6:59)
        if (currentHour >= TIME_BOUNDARIES.DAWN_START && currentHour < TIME_BOUNDARIES.DAWN_END) {
            return TimeOfDay.DAWN;
        }
        // Day: 7-18 UTC (7:00-17:59)
        if (currentHour >= TIME_BOUNDARIES.DAWN_END && currentHour < TIME_BOUNDARIES.DAY_END) {
            return TimeOfDay.DAY;
        }
        // Dusk: 18-20 UTC (18:00-19:59)
        if (currentHour >= TIME_BOUNDARIES.DAY_END && currentHour < TIME_BOUNDARIES.DUSK_END) {
            return TimeOfDay.DUSK;
        }
        // Night: 20-5 UTC (20:00-4:59)
        return TimeOfDay.NIGHT;
    }

    /**
     * Get a human-readable name for the time of day
     * @param timeOfDay - The time of day enum value
     * @returns Human-readable name
     */
    public getTimeOfDayName(timeOfDay: TimeOfDay): string {
        switch (timeOfDay) {
            case TimeOfDay.DAY:
                return 'Day';
            case TimeOfDay.NIGHT:
                return 'Night';
            case TimeOfDay.DAWN:
                return 'Dawn';
            case TimeOfDay.DUSK:
                return 'Dusk';
            case TimeOfDay.ANY:
                return 'Any Time';
            default:
                return 'Unknown';
        }
    }

    /**
     * Get an emoji for the time of day
     * @param timeOfDay - The time of day enum value
     * @returns Emoji representing the time of day
     */
    public getTimeOfDayEmoji(timeOfDay: TimeOfDay): string {
        switch (timeOfDay) {
            case TimeOfDay.DAY:
                return '☀️';
            case TimeOfDay.NIGHT:
                return '🌙';
            case TimeOfDay.DAWN:
                return '🌅';
            case TimeOfDay.DUSK:
                return '🌆';
            case TimeOfDay.ANY:
                return '🕐';
            default:
                return '❓';
        }
    }

    /**
     * Determine rarity based on weighted random selection
     * @param userId - Optional user ID to apply item effects
     * @param consumableBoost - Optional additional boost from a consumable item
     * @returns The selected rarity level
     */
    public async determineRarity(userId?: string, consumableBoost?: number): Promise<Rarity> {
        if (userId) {
            return await this.itemEffectsService.determineRarityWithEffects(userId, consumableBoost);
        }

        // Fallback to base weights if no user ID provided
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
     * Calculate final worth with item effects applied
     * @param baseWorth - Base worth of the fish
     * @param userId - Optional user ID to apply item effects
     * @returns Final worth after multipliers
     */
    public async calculateFinalWorth(baseWorth: number, userId?: string): Promise<number> {
        if (!userId) {
            return baseWorth;
        }

        const multiplier = await this.itemEffectsService.getTotalWorthMultiplier(userId);
        return this.itemEffectsService.applyWorthMultiplier(baseWorth, multiplier);
    }

    /**
     * Pick a random catchable by rarity
     * @param rarity - The rarity level to pick from
     * @param timeOfDay - Optional time of day to filter by (defaults to current time)
     * @returns A random catchable of the specified rarity, or null if none found
     */
    public async pickCatchableByRarity(rarity: Rarity, timeOfDay?: TimeOfDay): Promise<Catchable | null> {
        const db = getDb();

        try {
            // Determine current time of day if not provided
            const currentTimeOfDay = timeOfDay ?? this.getCurrentTimeOfDay();

            // Get a random catchable of this rarity that is available at this time of day
            // Fish are available if their timeOfDay is null (legacy), ANY, or matches the current time
            // Using ORDER BY RANDOM() LIMIT 1 for better performance with large datasets
            const result = await db
                .select()
                .from(catchables)
                .where(
                    and(
                        eq(catchables.rarity, rarity),
                        or(
                            isNull(catchables.timeOfDay),
                            eq(catchables.timeOfDay, TimeOfDay.ANY),
                            eq(catchables.timeOfDay, currentTimeOfDay)
                        )
                    )
                )
                .orderBy(sql`RANDOM()`)
                .limit(1);

            if (result.length === 0) {
                Logger.warn(`[FishingService] No catchables found for rarity ${rarity} at time ${currentTimeOfDay}`);
                return null;
            }

            return result[0];
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
