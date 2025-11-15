/**
 * Database utilities - Wrapper around service layer for backward compatibility
 * This file provides helper functions that delegate to the optimized service layer
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { Catchable, User } from '../db/schema.js';
import * as schema from '../db/schema.js';
import { Rarity } from '../enums/rarity.js';
import { getDb as getDatabase } from '../services/database.service.js';
import { FishingService } from '../services/fishing.service.js';
import { UserService } from '../services/user.service.js';

// Service instances
const userService = new UserService();
const fishingService = new FishingService();

/**
 * Get the Drizzle database instance
 * @returns Database instance
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
    return getDatabase();
}

/**
 * Ensure a user exists in the database
 * @param discordId - Discord user snowflake ID
 * @param discordTag - Discord user tag (optional)
 * @returns The user record
 */
export async function ensureUserExists(discordId: string, discordTag?: string): Promise<User> {
    return await userService.ensureUserExists(discordId, discordTag);
}

/**
 * Pick a random catchable by rarity level
 * @param rarity - Rarity level (0-3)
 * @returns A random catchable of the specified rarity
 */
export async function pickCatchableByRarity(rarity: number): Promise<Catchable | null> {
    return await fishingService.pickCatchableByRarity(rarity as Rarity);
}

/**
 * Add worth/money to a user
 * @param user - User object or user ID
 * @param worth - Amount to add
 */
export async function addWorthToUser(user: User | string, worth: number): Promise<void> {
    const userId = typeof user === 'string' ? user : user.id;
    await userService.addMoney(userId, worth);
}

/**
 * Mark a catchable as first caught by a user
 * @param user - User object or user ID
 * @param catchable - Catchable object or catchable ID
 */
export async function firstCatch(user: User | string, catchable: Catchable | string): Promise<void> {
    const userId = typeof user === 'string' ? user : user.id;
    const catchableId = typeof catchable === 'string' ? catchable : catchable.id;

    const isFirst = await fishingService.isFirstCatch(catchableId);

    if (isFirst) {
        await fishingService.markFirstCatch(catchableId, userId);
    }
}

/**
 * Add a catch record to the database
 * @param user - User object or user ID
 * @param catchable - Catchable object or catchable ID
 */
export async function addCatch(user: User | string, catchable: Catchable | string): Promise<void> {
    const userId = typeof user === 'string' ? user : user.id;
    const catchableId = typeof catchable === 'string' ? catchable : catchable.id;

    await fishingService.addCatch(userId, catchableId);
}

// Re-export services for direct access
export { userService, fishingService };

// Re-export types
export type { User, Catchable } from '../db/schema.js';
export { Rarity } from '../enums/rarity.js';
