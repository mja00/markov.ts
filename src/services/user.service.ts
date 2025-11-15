import { desc, eq, sql } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { catchables, catches, User, UserInsert, users } from '../db/schema.js';

/**
 * Service for managing user operations
 */
export class UserService {
    /**
     * Ensure a user exists in the database, create if not exists, update if exists
     * @param discordSnowflake - Discord user ID
     * @param discordTag - Discord user tag (optional)
     * @returns The user record
     */
    public async ensureUserExists(discordSnowflake: string, discordTag?: string): Promise<User> {
        const db = getDb();

        try {
            // Try to find existing user
            const existingUsers = await db
                .select()
                .from(users)
                .where(eq(users.discordSnowflake, discordSnowflake))
                .limit(1);

            if (existingUsers.length > 0) {
                const user = existingUsers[0];

                // Update discord tag if provided and different
                if (discordTag && user.discordTag !== discordTag) {
                    const updated = await db
                        .update(users)
                        .set({
                            discordTag,
                            updatedAt: new Date(),
                        })
                        .where(eq(users.id, user.id))
                        .returning();

                    Logger.debug(`[UserService] Updated user ${discordSnowflake} with new tag: ${discordTag}`);
                    return updated[0];
                }

                return user;
            }

            // Create new user
            const newUser: UserInsert = {
                discordSnowflake,
                discordTag: discordTag || null,
                money: 0,
                autoFishing: false,
            };

            const created = await db.insert(users).values(newUser).returning();

            Logger.info(`[UserService] Created new user: ${discordSnowflake}`);
            return created[0];
        } catch (error) {
            Logger.error(`[UserService] Failed to ensure user exists for ${discordSnowflake}:`, error);
            throw new Error(`Failed to ensure user exists: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a user by Discord snowflake
     * @param discordSnowflake - Discord user ID
     * @returns The user or null if not found
     */
    public async getUserBySnowflake(discordSnowflake: string): Promise<User | null> {
        const db = getDb();

        try {
            const result = await db
                .select()
                .from(users)
                .where(eq(users.discordSnowflake, discordSnowflake))
                .limit(1);

            return result[0] || null;
        } catch (error) {
            Logger.error(`[UserService] Failed to get user by snowflake ${discordSnowflake}:`, error);
            throw new Error(`Failed to get user: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a user by ID
     * @param userId - User UUID
     * @returns The user or null if not found
     */
    public async getUserById(userId: string): Promise<User | null> {
        const db = getDb();

        try {
            const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);

            return result[0] || null;
        } catch (error) {
            Logger.error(`[UserService] Failed to get user by ID ${userId}:`, error);
            throw new Error(`Failed to get user: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Add money to a user's balance
     * @param userId - User UUID
     * @param amount - Amount to add (can be negative to subtract)
     * @returns The updated user
     */
    public async addMoney(userId: string, amount: number): Promise<User> {
        const db = getDb();

        try {
            const updated = await db
                .update(users)
                .set({
                    money: sql`${users.money} + ${amount}`,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, userId))
                .returning();

            if (updated.length === 0) {
                throw new Error(`User ${userId} not found`);
            }

            Logger.debug(`[UserService] Added ${amount} money to user ${userId}`);
            return updated[0];
        } catch (error) {
            Logger.error(`[UserService] Failed to add money to user ${userId}:`, error);
            throw new Error(`Failed to add money: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Set a user's money balance
     * @param userId - User UUID
     * @param amount - New balance amount
     * @returns The updated user
     */
    public async setMoney(userId: string, amount: number): Promise<User> {
        const db = getDb();

        try {
            const updated = await db
                .update(users)
                .set({
                    money: amount,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, userId))
                .returning();

            if (updated.length === 0) {
                throw new Error(`User ${userId} not found`);
            }

            Logger.debug(`[UserService] Set money for user ${userId} to ${amount}`);
            return updated[0];
        } catch (error) {
            Logger.error(`[UserService] Failed to set money for user ${userId}:`, error);
            throw new Error(`Failed to set money: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get user statistics
     * @param userId - User UUID
     * @returns Statistics object
     */
    public async getUserStats(userId: string): Promise<{
        totalCatches: number;
        rarestCatch: { name: string; rarity: number } | null;
        totalValue: number;
        firstCatches: number;
    }> {
        const db = getDb();

        try {
            // Get total catches
            const totalCatchesResult = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(catches)
                .where(eq(catches.caughtBy, userId));

            const totalCatches = totalCatchesResult[0]?.count || 0;

            // Get rarest catch (highest rarity value)
            const rarestCatchResult = await db
                .select({
                    name: catchables.name,
                    rarity: catchables.rarity,
                })
                .from(catches)
                .innerJoin(catchables, eq(catches.catchableId, catchables.id))
                .where(eq(catches.caughtBy, userId))
                .orderBy(desc(catchables.rarity))
                .limit(1);

            const rarestCatch = rarestCatchResult[0] || null;

            // Get total value of all catches
            const totalValueResult = await db
                .select({
                    total: sql<number>`coalesce(sum(${catchables.worth}), 0)::int`,
                })
                .from(catches)
                .innerJoin(catchables, eq(catches.catchableId, catchables.id))
                .where(eq(catches.caughtBy, userId));

            const totalValue = totalValueResult[0]?.total || 0;

            // Get first catches count
            const firstCatchesResult = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(catchables)
                .where(eq(catchables.firstCaughtBy, userId));

            const firstCatches = firstCatchesResult[0]?.count || 0;

            return {
                totalCatches,
                rarestCatch,
                totalValue,
                firstCatches,
            };
        } catch (error) {
            Logger.error(`[UserService] Failed to get user stats for ${userId}:`, error);
            throw new Error(`Failed to get user stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get top users by money
     * @param limit - Number of users to return
     * @returns Array of users ordered by money
     */
    public async getTopUsersByMoney(limit: number = 10): Promise<User[]> {
        const db = getDb();

        try {
            return await db.select().from(users).orderBy(desc(users.money)).limit(limit);
        } catch (error) {
            Logger.error('[UserService] Failed to get top users by money:', error);
            throw new Error(`Failed to get top users: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get top users by total catches
     * @param limit - Number of users to return
     * @returns Array of users with catch counts
     */
    public async getTopUsersByCatches(limit: number = 10): Promise<
        Array<{
            user: User;
            catchCount: number;
        }>
    > {
        const db = getDb();

        try {
            const result = await db
                .select({
                    user: users,
                    catchCount: sql<number>`count(${catches.id})::int`,
                })
                .from(users)
                .leftJoin(catches, eq(users.id, catches.caughtBy))
                .groupBy(users.id)
                .orderBy(desc(sql`count(${catches.id})`))
                .limit(limit);

            return result;
        } catch (error) {
            Logger.error('[UserService] Failed to get top users by catches:', error);
            throw new Error(`Failed to get top users: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Toggle auto fishing for a user
     * @param userId - User UUID
     * @returns The updated user
     */
    public async toggleAutoFishing(userId: string): Promise<User> {
        const db = getDb();

        try {
            const user = await this.getUserById(userId);

            if (!user) {
                throw new Error(`User ${userId} not found`);
            }

            const updated = await db
                .update(users)
                .set({
                    autoFishing: !user.autoFishing,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, userId))
                .returning();

            Logger.debug(`[UserService] Toggled auto fishing for user ${userId} to ${!user.autoFishing}`);
            return updated[0];
        } catch (error) {
            Logger.error(`[UserService] Failed to toggle auto fishing for user ${userId}:`, error);
            throw new Error(`Failed to toggle auto fishing: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
