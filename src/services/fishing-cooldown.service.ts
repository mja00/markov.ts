import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { GuildService } from './guild.service.js';
import { Logger } from './logger.js';
import { FishingAttemptInsert, fishingAttempts } from '../db/schema.js';

/**
 * Result of a cooldown check
 */
export interface CooldownCheckResult {
    allowed: boolean;
    remainingAttempts: number;
    timeUntilNextAttempt: number; // seconds until oldest attempt expires
    limit: number;
    windowSeconds: number;
}

/**
 * Service for managing fishing cooldown checks
 */
export class FishingCooldownService {
    private readonly guildService: GuildService;

    constructor() {
        this.guildService = new GuildService();
    }

    /**
     * Check if user can fish based on cooldown limits
     * @param userId - User UUID
     * @param guildDiscordSnowflake - Discord guild ID (null for DM context)
     * @returns Cooldown check result
     */
    public async checkCooldown(userId: string, guildDiscordSnowflake: string | null): Promise<CooldownCheckResult> {
        const db = getDb();

        try {
            // If in guild context, ensure guild exists before checking cooldown
            // This prevents new guilds from sharing the DM cooldown bucket
            let finalGuildId: string | null = null;
            if (guildDiscordSnowflake) {
                const guild = await this.guildService.ensureGuildExists(guildDiscordSnowflake);
                finalGuildId = guild.id;
            }

            // Get guild settings (with defaults)
            const settings = await this.guildService.getGuildSettings(guildDiscordSnowflake);
            const { limit, windowSeconds } = settings;
            
            // Use the ensured guildId instead of the one from settings
            // This ensures new guilds have their own cooldown bucket
            const guildId = finalGuildId;

            // Calculate the cutoff time for the rolling window
            const cutoffTime = new Date(Date.now() - windowSeconds * 1000);

            // Count attempts within the window
            const whereConditions = [
                eq(fishingAttempts.userId, userId),
                gte(fishingAttempts.attemptedAt, cutoffTime),
            ];

            // If guildId is null (DM context), match null guildId
            // If guildId exists, match that guildId
            if (guildId === null) {
                whereConditions.push(isNull(fishingAttempts.guildId));
            } else {
                whereConditions.push(eq(fishingAttempts.guildId, guildId));
            }

            const attemptsResult = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(fishingAttempts)
                .where(and(...whereConditions));

            const attemptCount = attemptsResult[0]?.count || 0;
            const remainingAttempts = Math.max(0, limit - attemptCount);
            const allowed = attemptCount < limit;

            // Calculate time until next attempt is available
            let timeUntilNextAttempt = 0;
            if (!allowed && attemptCount > 0) {
                // Get the oldest attempt in the window
                const oldestAttemptResult = await db
                    .select({
                        attemptedAt: fishingAttempts.attemptedAt,
                    })
                    .from(fishingAttempts)
                    .where(and(...whereConditions))
                    .orderBy(fishingAttempts.attemptedAt)
                    .limit(1);

                if (oldestAttemptResult.length > 0) {
                    const oldestAttemptTime = oldestAttemptResult[0].attemptedAt.getTime();
                    const expirationTime = oldestAttemptTime + windowSeconds * 1000;
                    const now = Date.now();
                    timeUntilNextAttempt = Math.max(0, Math.ceil((expirationTime - now) / 1000));
                }
            }

            return {
                allowed,
                remainingAttempts,
                timeUntilNextAttempt,
                limit,
                windowSeconds,
            };
        } catch (error) {
            Logger.error(`[FishingCooldownService] Failed to check cooldown for user ${userId}:`, error);
            throw new Error(`Failed to check cooldown: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Record a fishing attempt
     * @param userId - User UUID
     * @param guildDiscordSnowflake - Discord guild ID (null for DM context)
     * @returns The created attempt record
     */
    public async recordAttempt(userId: string, guildDiscordSnowflake: string | null): Promise<void> {
        const db = getDb();

        try {
            // If in guild context, ensure guild exists
            let finalGuildId: string | null = null;
            if (guildDiscordSnowflake) {
                const guild = await this.guildService.ensureGuildExists(guildDiscordSnowflake);
                finalGuildId = guild.id;
            }

            const newAttempt: FishingAttemptInsert = {
                userId,
                guildId: finalGuildId,
                attemptedAt: new Date(),
            };

            await db.insert(fishingAttempts).values(newAttempt);

            Logger.debug(`[FishingCooldownService] Recorded fishing attempt for user ${userId} in guild ${guildDiscordSnowflake || 'DM'}`);
        } catch (error) {
            Logger.error(`[FishingCooldownService] Failed to record attempt for user ${userId}:`, error);
            throw new Error(`Failed to record attempt: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get remaining attempts for a user
     * @param userId - User UUID
     * @param guildDiscordSnowflake - Discord guild ID (null for DM context)
     * @returns Number of remaining attempts
     */
    public async getRemainingAttempts(userId: string, guildDiscordSnowflake: string | null): Promise<number> {
        const result = await this.checkCooldown(userId, guildDiscordSnowflake);
        return result.remainingAttempts;
    }

    /**
     * Get time until next attempt is available (in seconds)
     * @param userId - User UUID
     * @param guildDiscordSnowflake - Discord guild ID (null for DM context)
     * @returns Seconds until next attempt available, or 0 if allowed
     */
    public async getTimeUntilNextAttempt(userId: string, guildDiscordSnowflake: string | null): Promise<number> {
        const result = await this.checkCooldown(userId, guildDiscordSnowflake);
        return result.timeUntilNextAttempt;
    }
}

