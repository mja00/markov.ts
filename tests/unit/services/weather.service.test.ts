import { describe, expect, it, vi } from 'vitest';

// Mock the logger to prevent config.json loading
vi.mock('../../../src/services/logger.js', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

import { Weather } from '../../../src/enums/weather.js';
import { WeatherService } from '../../../src/services/weather.service.js';

describe('WeatherService', () => {
    const weatherService = new WeatherService();

    describe('getWeatherName', () => {
        it('should return "Sunny" for SUNNY weather', () => {
            const result = weatherService.getWeatherName(Weather.SUNNY);
            expect(result).toBe('Sunny');
        });

        it('should return "Rainy" for RAINY weather', () => {
            const result = weatherService.getWeatherName(Weather.RAINY);
            expect(result).toBe('Rainy');
        });

        it('should return "Stormy" for STORMY weather', () => {
            const result = weatherService.getWeatherName(Weather.STORMY);
            expect(result).toBe('Stormy');
        });

        it('should return "Foggy" for FOGGY weather', () => {
            const result = weatherService.getWeatherName(Weather.FOGGY);
            expect(result).toBe('Foggy');
        });

        it('should return "Snowy" for SNOWY weather', () => {
            const result = weatherService.getWeatherName(Weather.SNOWY);
            expect(result).toBe('Snowy');
        });

        it('should return "Unknown" for invalid weather', () => {
            const result = weatherService.getWeatherName('INVALID' as Weather);
            expect(result).toBe('Unknown');
        });
    });

    describe('getWeatherEmoji', () => {
        it('should return sun emoji for SUNNY weather', () => {
            const result = weatherService.getWeatherEmoji(Weather.SUNNY);
            expect(result).toBe('☀️');
        });

        it('should return rain emoji for RAINY weather', () => {
            const result = weatherService.getWeatherEmoji(Weather.RAINY);
            expect(result).toBe('🌧️');
        });

        it('should return storm emoji for STORMY weather', () => {
            const result = weatherService.getWeatherEmoji(Weather.STORMY);
            expect(result).toBe('⛈️');
        });

        it('should return fog emoji for FOGGY weather', () => {
            const result = weatherService.getWeatherEmoji(Weather.FOGGY);
            expect(result).toBe('🌫️');
        });

        it('should return snow emoji for SNOWY weather', () => {
            const result = weatherService.getWeatherEmoji(Weather.SNOWY);
            expect(result).toBe('❄️');
        });

        it('should return question mark emoji for invalid weather', () => {
            const result = weatherService.getWeatherEmoji('INVALID' as Weather);
            expect(result).toBe('❓');
        });
    });

    describe('getWeatherDescription', () => {
        it('should return correct description for SUNNY weather', () => {
            const result = weatherService.getWeatherDescription(Weather.SUNNY);
            expect(result).toBe('Normal fishing conditions');
        });

        it('should return correct description for RAINY weather', () => {
            const result = weatherService.getWeatherDescription(Weather.RAINY);
            expect(result).toBe('Rare fish are more active (+10% chance)');
        });

        it('should return correct description for STORMY weather', () => {
            const result = weatherService.getWeatherDescription(Weather.STORMY);
            expect(result).toBe('Legendary fish appear more often (+20% chance), but common fish hide (-50% chance)');
        });

        it('should return correct description for FOGGY weather', () => {
            const result = weatherService.getWeatherDescription(Weather.FOGGY);
            expect(result).toBe('Uncommon fish are easier to find (+15% chance), common fish less likely (-30% chance)');
        });

        it('should return correct description for SNOWY weather', () => {
            const result = weatherService.getWeatherDescription(Weather.SNOWY);
            expect(result).toBe('Rare fish are more active (+10% chance), common fish less likely (-20% chance)');
        });

        it('should return unknown description for invalid weather', () => {
            const result = weatherService.getWeatherDescription('INVALID' as Weather);
            expect(result).toBe('Unknown weather effects');
        });
    });

    describe('getWeatherEffects', () => {
        it('should return normal modifiers for SUNNY weather', () => {
            const result = weatherService.getWeatherEffects(Weather.SUNNY);
            expect(result).toEqual({
                commonModifier: 1.0,
                uncommonModifier: 1.0,
                rareModifier: 1.0,
                legendaryModifier: 1.0,
            });
        });

        it('should return correct modifiers for RAINY weather', () => {
            const result = weatherService.getWeatherEffects(Weather.RAINY);
            expect(result).toEqual({
                commonModifier: 0.95,
                uncommonModifier: 0.95,
                rareModifier: 1.1,
                legendaryModifier: 1.0,
            });
        });

        it('should return correct modifiers for STORMY weather', () => {
            const result = weatherService.getWeatherEffects(Weather.STORMY);
            expect(result).toEqual({
                commonModifier: 0.5,
                uncommonModifier: 1.0,
                rareModifier: 1.0,
                legendaryModifier: 1.2,
            });
        });

        it('should return correct modifiers for FOGGY weather', () => {
            const result = weatherService.getWeatherEffects(Weather.FOGGY);
            expect(result).toEqual({
                commonModifier: 0.7,
                uncommonModifier: 1.15,
                rareModifier: 1.0,
                legendaryModifier: 1.0,
            });
        });

        it('should return correct modifiers for SNOWY weather', () => {
            const result = weatherService.getWeatherEffects(Weather.SNOWY);
            expect(result).toEqual({
                commonModifier: 0.8,
                uncommonModifier: 1.0,
                rareModifier: 1.1,
                legendaryModifier: 1.0,
            });
        });

        it('should return default modifiers for invalid weather', () => {
            const result = weatherService.getWeatherEffects('INVALID' as Weather);
            expect(result).toEqual({
                commonModifier: 1.0,
                uncommonModifier: 1.0,
                rareModifier: 1.0,
                legendaryModifier: 1.0,
            });
        });
    });

    describe('getCurrentWeather', () => {
        it('should return SUNNY for null guild ID (DM context)', async () => {
            const result = await weatherService.getCurrentWeather(null);
            expect(result).toBe(Weather.SUNNY);
        });
    });

    describe('getTimeUntilNextChange', () => {
        it('should return null for null guild ID (DM context)', async () => {
            const result = await weatherService.getTimeUntilNextChange(null);
            expect(result).toBeNull();
        });
    });
});
