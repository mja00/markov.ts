import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { ShopService } from './shop.service.js';
import { inventory, Item, items } from '../db/schema.js';
import { Rarity } from '../enums/rarity.js';

/**
 * Effect types that items can have
 */
export enum EffectType {
    RARITY_BOOST = 'RARITY_BOOST',
    WORTH_MULTIPLIER = 'WORTH_MULTIPLIER',
}

/**
 * Rarity weights for random selection
 * Total weight: 100
 */
const BASE_RARITY_WEIGHTS = {
    [Rarity.COMMON]: 60, // 60%
    [Rarity.UNCOMMON]: 30, // 30%
    [Rarity.RARE]: 8, // 8%
    [Rarity.LEGENDARY]: 2, // 2%
};

/**
 * Service for managing item effects
 */
export class ItemEffectsService {
    private readonly shopService: ShopService;

    constructor() {
        this.shopService = new ShopService();
    }
    /**
     * Get all passive items owned by a user
     * @param userId - The user UUID
     * @returns Array of items with passive effects
     */
    public async getPassiveItems(userId: string): Promise<Item[]> {
        const db = getDb();

        try {
            const result = await db
                .select({
                    item: items,
                })
                .from(inventory)
                .innerJoin(items, eq(inventory.itemId, items.id))
                .where(
                    and(
                        eq(inventory.userId, userId),
                        eq(items.isPassive, true),
                        isNotNull(items.effectType),
                        gt(inventory.count, 0),
                    ),
                );

            return result.map((r) => r.item);
        } catch (error) {
            Logger.error(`[ItemEffectsService] Failed to get passive items for user ${userId}:`, error);
            throw new Error(`Failed to get passive items: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get the best consumable item for rarity boost
     * @param userId - The user UUID
     * @returns The best consumable item with rarity boost, or null if none found
     */
    public async getBestConsumableRarityBoost(userId: string): Promise<{ item: Item; inventoryCount: number } | null> {
        const db = getDb();

        try {
            const result = await db
                .select({
                    item: items,
                    inventory: inventory,
                })
                .from(inventory)
                .innerJoin(items, eq(inventory.itemId, items.id))
                .where(
                    and(
                        eq(inventory.userId, userId),
                        eq(items.isConsumable, true),
                        eq(items.isPassive, false),
                        eq(items.effectType, EffectType.RARITY_BOOST),
                        isNotNull(items.effectValue),
                        gt(inventory.count, 0),
                    ),
                )
                .orderBy(sql`${items.effectValue} DESC`)
                .limit(1);

            if (result.length === 0) {
                return null;
            }

            return {
                item: result[0].item,
                inventoryCount: result[0].inventory.count,
            };
        } catch (error) {
            Logger.error(`[ItemEffectsService] Failed to get best consumable for user ${userId}:`, error);
            throw new Error(`Failed to get best consumable: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Use a consumable item (consume one from inventory)
     * @param userId - The user UUID
     * @param itemId - The item UUID
     * @returns The item that was consumed, or null if not found/not enough
     */
    public async useConsumable(userId: string, itemId: string): Promise<Item | null> {
        try {
            const inventoryItem = await this.shopService.getInventoryItem(userId, itemId);

            if (!inventoryItem) {
                return null;
            }

            // Check if item is consumable
            if (!inventoryItem.item.isConsumable) {
                Logger.warn(`[ItemEffectsService] Attempted to use non-consumable item ${itemId} by user ${userId}`);
                return null;
            }

            // Remove one from inventory
            await this.shopService.removeFromInventory(userId, itemId, 1);

            Logger.info(`[ItemEffectsService] User ${userId} used consumable item ${inventoryItem.item.name}`);

            return inventoryItem.item;
        } catch (error) {
            Logger.error(`[ItemEffectsService] Failed to use consumable for user ${userId}:`, error);
            return null;
        }
    }

    /**
     * Calculate total rarity boost from passive items
     * @param userId - The user UUID
     * @returns Total rarity boost percentage (e.g., 0.1 = 10%)
     */
    public async getTotalRarityBoost(userId: string): Promise<number> {
        const passiveItems = await this.getPassiveItems(userId);
        let totalBoost = 0;

        for (const item of passiveItems) {
            if (item.effectType === EffectType.RARITY_BOOST && item.effectValue) {
                const boostValue = parseFloat(item.effectValue);
                if (!isNaN(boostValue)) {
                    totalBoost += boostValue;
                }
            }
        }

        return totalBoost;
    }

    /**
     * Calculate total worth multiplier from passive items
     * @param userId - The user UUID
     * @returns Total worth multiplier (e.g., 1.5 = 1.5x)
     */
    public async getTotalWorthMultiplier(userId: string): Promise<number> {
        const passiveItems = await this.getPassiveItems(userId);
        let totalMultiplier = 1.0;

        for (const item of passiveItems) {
            if (item.effectType === EffectType.WORTH_MULTIPLIER && item.effectValue) {
                const multiplierValue = parseFloat(item.effectValue);
                if (!isNaN(multiplierValue) && multiplierValue > 0) {
                    totalMultiplier *= multiplierValue;
                }
            }
        }

        return totalMultiplier;
    }

    /**
     * Apply rarity boost to rarity weights
     * Shifts weights toward higher rarities
     * @param boost - Boost percentage (e.g., 0.1 = 10%)
     * @returns Modified rarity weights
     */
    public applyRarityBoost(boost: number): typeof BASE_RARITY_WEIGHTS {
        if (boost <= 0) {
            return { ...BASE_RARITY_WEIGHTS };
        }

        // Cap boost at 50% to prevent extreme shifts
        const cappedBoost = Math.min(boost, 0.5);

        // Calculate how much to reduce from COMMON
        const reductionFromCommon = BASE_RARITY_WEIGHTS[Rarity.COMMON] * cappedBoost;

        // Distribute the reduction proportionally to higher rarities
        const totalHigherRarityWeight =
            BASE_RARITY_WEIGHTS[Rarity.UNCOMMON] +
            BASE_RARITY_WEIGHTS[Rarity.RARE] +
            BASE_RARITY_WEIGHTS[Rarity.LEGENDARY];

        const weights = { ...BASE_RARITY_WEIGHTS };

        // Reduce COMMON
        weights[Rarity.COMMON] = Math.max(0, BASE_RARITY_WEIGHTS[Rarity.COMMON] - reductionFromCommon);

        // Increase higher rarities proportionally
        if (totalHigherRarityWeight > 0) {
            const uncommonRatio = BASE_RARITY_WEIGHTS[Rarity.UNCOMMON] / totalHigherRarityWeight;
            const rareRatio = BASE_RARITY_WEIGHTS[Rarity.RARE] / totalHigherRarityWeight;
            const legendaryRatio = BASE_RARITY_WEIGHTS[Rarity.LEGENDARY] / totalHigherRarityWeight;

            weights[Rarity.UNCOMMON] = BASE_RARITY_WEIGHTS[Rarity.UNCOMMON] + reductionFromCommon * uncommonRatio;
            weights[Rarity.RARE] = BASE_RARITY_WEIGHTS[Rarity.RARE] + reductionFromCommon * rareRatio;
            weights[Rarity.LEGENDARY] = BASE_RARITY_WEIGHTS[Rarity.LEGENDARY] + reductionFromCommon * legendaryRatio;
        }

        // Normalize to ensure total is still 100
        const total = Object.values(weights).reduce((sum, val) => sum + val, 0);
        if (total !== 100) {
            const factor = 100 / total;
            weights[Rarity.COMMON] *= factor;
            weights[Rarity.UNCOMMON] *= factor;
            weights[Rarity.RARE] *= factor;
            weights[Rarity.LEGENDARY] *= factor;
        }

        return weights;
    }

    /**
     * Apply worth multiplier to fish worth
     * @param baseWorth - Base worth of the fish
     * @param multiplier - Multiplier value (e.g., 1.5 = 1.5x)
     * @returns Final worth after multiplier
     */
    public applyWorthMultiplier(baseWorth: number, multiplier: number): number {
        if (multiplier <= 0) {
            return baseWorth;
        }

        return Math.floor(baseWorth * multiplier);
    }

    /**
     * Determine rarity based on weighted random selection with item effects
     * @param userId - The user UUID (optional)
     * @param consumableBoost - Optional additional boost from a consumable item
     * @returns The selected rarity level
     */
    public async determineRarityWithEffects(userId?: string, consumableBoost?: number): Promise<Rarity> {
        let weights = { ...BASE_RARITY_WEIGHTS };
        let totalBoost = 0;

        if (userId) {
            // Get passive item boost
            const passiveBoost = await this.getTotalRarityBoost(userId);
            totalBoost += passiveBoost;
        }

        // Add consumable boost if provided
        if (consumableBoost !== undefined && consumableBoost > 0) {
            totalBoost += consumableBoost;
        }

        if (totalBoost > 0) {
            weights = this.applyRarityBoost(totalBoost);
            Logger.debug(`[ItemEffectsService] Applied total rarity boost of ${totalBoost * 100}% for user ${userId || 'unknown'}`);
        }

        const random = Math.random() * 100;
        let cumulative = 0;

        // Iterate through rarities from highest to lowest
        for (const rarity of [Rarity.LEGENDARY, Rarity.RARE, Rarity.UNCOMMON, Rarity.COMMON]) {
            cumulative += weights[rarity];
            if (random < cumulative) {
                return rarity;
            }
        }

        // Fallback to common (should never reach here)
        return Rarity.COMMON;
    }
}

