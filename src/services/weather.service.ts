import { eq } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { GuildWeather, GuildWeatherInsert, guildWeather } from '../db/schema.js';
import { Weather } from '../enums/weather.js';

/**
 * Weather change interval in milliseconds (4-6 hours)
 * We'll randomize between these values
 */
const MIN_WEATHER_CHANGE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const MAX_WEATHER_CHANGE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Weather effect modifiers for rarity calculations
 * These modify the base rarity weights in FishingService
 */
interface WeatherEffects {
    commonModifier: number;
    uncommonModifier: number;
    rareModifier: number;
    legendaryModifier: number;
}

/**
 * Service for managing weather operations
 */
export class WeatherService {
    /**
     * Get weather effects for a specific weather type
     * @param weather - The weather type
     * @returns Weather effect modifiers
     */
    public getWeatherEffects(weather: Weather): WeatherEffects {
        switch (weather) {
            case Weather.SUNNY:
                // Normal conditions - no modifiers
                return {
                    commonModifier: 1.0,
                    uncommonModifier: 1.0,
                    rareModifier: 1.0,
                    legendaryModifier: 1.0,
                };
            case Weather.RAINY:
                // +10% rare fish chance
                return {
                    commonModifier: 0.95,
                    uncommonModifier: 0.95,
                    rareModifier: 1.1,
                    legendaryModifier: 1.0,
                };
            case Weather.STORMY:
                // +20% legendary chance, -50% common
                return {
                    commonModifier: 0.5,
                    uncommonModifier: 1.0,
                    rareModifier: 1.0,
                    legendaryModifier: 1.2,
                };
            case Weather.FOGGY:
                // +15% uncommon chance, -30% common
                return {
                    commonModifier: 0.7,
                    uncommonModifier: 1.15,
                    rareModifier: 1.0,
                    legendaryModifier: 1.0,
                };
            case Weather.SNOWY:
                // +10% rare chance, -20% common
                return {
                    commonModifier: 0.8,
                    uncommonModifier: 1.0,
                    rareModifier: 1.1,
                    legendaryModifier: 1.0,
                };
            default:
                // Default to sunny conditions
                return {
                    commonModifier: 1.0,
                    uncommonModifier: 1.0,
                    rareModifier: 1.0,
                    legendaryModifier: 1.0,
                };
        }
    }

    /**
     * Get a human-readable name for the weather
     * @param weather - The weather enum value
     * @returns Human-readable name
     */
    public getWeatherName(weather: Weather): string {
        switch (weather) {
            case Weather.SUNNY:
                return 'Sunny';
            case Weather.RAINY:
                return 'Rainy';
            case Weather.STORMY:
                return 'Stormy';
            case Weather.FOGGY:
                return 'Foggy';
            case Weather.SNOWY:
                return 'Snowy';
            default:
                return 'Unknown';
        }
    }

    /**
     * Get an emoji for the weather
     * @param weather - The weather enum value
     * @returns Emoji representing the weather
     */
    public getWeatherEmoji(weather: Weather): string {
        switch (weather) {
            case Weather.SUNNY:
                return '☀️';
            case Weather.RAINY:
                return '🌧️';
            case Weather.STORMY:
                return '⛈️';
            case Weather.FOGGY:
                return '🌫️';
            case Weather.SNOWY:
                return '❄️';
            default:
                return '❓';
        }
    }

    /**
     * Get a description of the weather's effects
     * @param weather - The weather enum value
     * @returns Description of weather effects
     */
    public getWeatherDescription(weather: Weather): string {
        switch (weather) {
            case Weather.SUNNY:
                return 'Normal fishing conditions';
            case Weather.RAINY:
                return 'Rare fish are more active (+10% chance)';
            case Weather.STORMY:
                return 'Legendary fish appear more often (+20% chance), but common fish hide (-50% chance)';
            case Weather.FOGGY:
                return 'Uncommon fish are easier to find (+15% chance), common fish less likely (-30% chance)';
            case Weather.SNOWY:
                return 'Rare fish are more active (+10% chance), common fish less likely (-20% chance)';
            default:
                return 'Unknown weather effects';
        }
    }

    /**
     * Generate a random weather type
     * @returns Random weather type
     */
    private generateRandomWeather(): Weather {
        const weathers = [Weather.SUNNY, Weather.RAINY, Weather.STORMY, Weather.FOGGY, Weather.SNOWY];
        const randomIndex = Math.floor(Math.random() * weathers.length);
        return weathers[randomIndex];
    }

    /**
     * Calculate the next weather change time (4-6 hours from now)
     * @returns Timestamp for next weather change
     */
    private calculateNextChangeTime(): Date {
        const randomInterval =
            MIN_WEATHER_CHANGE_INTERVAL + Math.random() * (MAX_WEATHER_CHANGE_INTERVAL - MIN_WEATHER_CHANGE_INTERVAL);
        return new Date(Date.now() + randomInterval);
    }

    /**
     * Get or create guild weather
     * @param guildId - Guild UUID
     * @returns Guild weather record
     */
    public async getOrCreateGuildWeather(guildId: string): Promise<GuildWeather> {
        const db = getDb();

        try {
            // Try to find existing weather
            const existingWeather = await db.select().from(guildWeather).where(eq(guildWeather.guildId, guildId)).limit(1);

            if (existingWeather.length > 0) {
                // Check if weather needs to be updated
                const weather = existingWeather[0];
                if (new Date() >= weather.nextChangeAt) {
                    // Time to change the weather
                    return await this.updateGuildWeather(weather.id);
                }
                return weather;
            }

            // Create new guild weather with random starting weather
            const randomWeather = this.generateRandomWeather();
            const newWeather: GuildWeatherInsert = {
                guildId,
                currentWeather: randomWeather as any, // Type cast needed due to enum vs string type
                nextChangeAt: this.calculateNextChangeTime(),
            };

            const created = await db.insert(guildWeather).values(newWeather).returning();

            Logger.info(`[WeatherService] Created new guild weather for guild ${guildId}: ${created[0].currentWeather}`);
            return created[0];
        } catch (error) {
            Logger.error(`[WeatherService] Failed to get or create guild weather for ${guildId}:`, error);
            throw new Error(`Failed to get or create guild weather: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update guild weather to a new random weather
     * @param weatherId - Weather record UUID
     * @returns Updated guild weather
     */
    private async updateGuildWeather(weatherId: string): Promise<GuildWeather> {
        const db = getDb();

        try {
            const newWeather = this.generateRandomWeather();
            const nextChangeAt = this.calculateNextChangeTime();

            const updated = await db
                .update(guildWeather)
                .set({
                    currentWeather: newWeather as any, // Type cast needed due to enum vs string type
                    nextChangeAt,
                    updatedAt: new Date(),
                })
                .where(eq(guildWeather.id, weatherId))
                .returning();

            if (updated.length === 0) {
                throw new Error('Weather record not found');
            }

            Logger.info(`[WeatherService] Updated guild weather to ${newWeather}, next change at ${nextChangeAt}`);
            return updated[0];
        } catch (error) {
            Logger.error(`[WeatherService] Failed to update guild weather ${weatherId}:`, error);
            throw new Error(`Failed to update guild weather: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get current weather for a guild (returns SUNNY for DM context)
     * @param guildId - Guild UUID (null for DM context)
     * @returns Current weather
     */
    public async getCurrentWeather(guildId: string | null): Promise<Weather> {
        if (!guildId) {
            // DM context - default to sunny
            return Weather.SUNNY;
        }

        const weatherRecord = await this.getOrCreateGuildWeather(guildId);
        return weatherRecord.currentWeather as Weather;
    }

    /**
     * Get time until next weather change
     * @param guildId - Guild UUID (null for DM context)
     * @returns Milliseconds until next weather change, or null if in DM
     */
    public async getTimeUntilNextChange(guildId: string | null): Promise<number | null> {
        if (!guildId) {
            return null;
        }

        const weatherRecord = await this.getOrCreateGuildWeather(guildId);
        return weatherRecord.nextChangeAt.getTime() - Date.now();
    }
}
