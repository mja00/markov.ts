import { eq } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { Guild, GuildInsert, guilds } from '../db/schema.js';

/**
 * Default fishing cooldown settings
 */
export const DEFAULT_FISHING_COOLDOWN_LIMIT = 10;
export const DEFAULT_FISHING_COOLDOWN_WINDOW_SECONDS = 3600; // 1 hour

/**
 * Service for managing guild operations
 */
export class GuildService {
    /**
     * Ensure a guild exists in the database, create if not exists
     * @param discordSnowflake - Discord guild ID
     * @returns The guild record
     */
    public async ensureGuildExists(discordSnowflake: string): Promise<Guild> {
        const db = getDb();

        try {
            // Try to find existing guild
            const existingGuilds = await db
                .select()
                .from(guilds)
                .where(eq(guilds.discordSnowflake, discordSnowflake))
                .limit(1);

            if (existingGuilds.length > 0) {
                return existingGuilds[0];
            }

            // Create new guild with default settings
            const newGuild: GuildInsert = {
                discordSnowflake,
                fishingCooldownLimit: DEFAULT_FISHING_COOLDOWN_LIMIT,
                fishingCooldownWindowSeconds: DEFAULT_FISHING_COOLDOWN_WINDOW_SECONDS,
            };

            const created = await db.insert(guilds).values(newGuild).returning();

            Logger.info(`[GuildService] Created new guild: ${discordSnowflake}`);
            return created[0];
        } catch (error) {
            Logger.error(`[GuildService] Failed to ensure guild exists for ${discordSnowflake}:`, error);
            throw new Error(`Failed to ensure guild exists: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get guild settings by Discord snowflake
     * @param discordSnowflake - Discord guild ID
     * @returns The guild settings, or null if not found
     */
    public async getGuildByDiscordSnowflake(discordSnowflake: string): Promise<Guild | null> {
        const db = getDb();

        try {
            const result = await db
                .select()
                .from(guilds)
                .where(eq(guilds.discordSnowflake, discordSnowflake))
                .limit(1);

            return result[0] || null;
        } catch (error) {
            Logger.error(`[GuildService] Failed to get guild ${discordSnowflake}:`, error);
            throw new Error(`Failed to get guild: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get guild settings (with defaults if not found)
     * @param discordSnowflake - Discord guild ID (optional, null for DM context)
     * @returns Guild settings with defaults applied
     */
    public async getGuildSettings(discordSnowflake: string | null): Promise<{
        limit: number;
        windowSeconds: number;
        guildId: string | null;
    }> {
        if (!discordSnowflake) {
            // DM context - return defaults
            return {
                limit: DEFAULT_FISHING_COOLDOWN_LIMIT,
                windowSeconds: DEFAULT_FISHING_COOLDOWN_WINDOW_SECONDS,
                guildId: null,
            };
        }

        const guild = await this.getGuildByDiscordSnowflake(discordSnowflake);

        if (!guild) {
            // Guild not found - return defaults
            return {
                limit: DEFAULT_FISHING_COOLDOWN_LIMIT,
                windowSeconds: DEFAULT_FISHING_COOLDOWN_WINDOW_SECONDS,
                guildId: null,
            };
        }

        return {
            limit: guild.fishingCooldownLimit,
            windowSeconds: guild.fishingCooldownWindowSeconds,
            guildId: guild.id,
        };
    }

    /**
     * Update fishing cooldown settings for a guild
     * @param discordSnowflake - Discord guild ID
     * @param limit - Maximum fishing attempts allowed
     * @param windowSeconds - Rolling time window in seconds
     * @returns The updated guild record
     */
    public async updateFishingCooldown(
        discordSnowflake: string,
        limit: number,
        windowSeconds: number,
    ): Promise<Guild> {
        const db = getDb();

        try {
            // Ensure guild exists first
            const guild = await this.ensureGuildExists(discordSnowflake);

            // Update settings
            const updated = await db
                .update(guilds)
                .set({
                    fishingCooldownLimit: limit,
                    fishingCooldownWindowSeconds: windowSeconds,
                    updatedAt: new Date(),
                })
                .where(eq(guilds.id, guild.id))
                .returning();

            Logger.info(`[GuildService] Updated fishing cooldown for guild ${discordSnowflake}: ${limit} attempts per ${windowSeconds} seconds`);

            return updated[0];
        } catch (error) {
            Logger.error(`[GuildService] Failed to update fishing cooldown for ${discordSnowflake}:`, error);
            throw new Error(`Failed to update fishing cooldown: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a guild by internal ID
     * @param guildId - Guild UUID
     * @returns The guild or null if not found
     */
    public async getGuildById(guildId: string): Promise<Guild | null> {
        const db = getDb();

        try {
            const result = await db.select().from(guilds).where(eq(guilds.id, guildId)).limit(1);

            return result[0] || null;
        } catch (error) {
            Logger.error(`[GuildService] Failed to get guild by ID ${guildId}:`, error);
            throw new Error(`Failed to get guild: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

