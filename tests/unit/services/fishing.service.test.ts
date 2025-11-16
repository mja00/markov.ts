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

import { Rarity } from '../../../src/enums/rarity.js';
import { TimeOfDay } from '../../../src/enums/time-of-day.js';
import { FishingService } from '../../../src/services/fishing.service.js';

describe('FishingService', () => {
    const fishingService = new FishingService();

    describe('getRarityName', () => {
        it('should return "Common" for COMMON rarity', () => {
            const result = fishingService.getRarityName(Rarity.COMMON);
            expect(result).toBe('Common');
        });

        it('should return "Uncommon" for UNCOMMON rarity', () => {
            const result = fishingService.getRarityName(Rarity.UNCOMMON);
            expect(result).toBe('Uncommon');
        });

        it('should return "Rare" for RARE rarity', () => {
            const result = fishingService.getRarityName(Rarity.RARE);
            expect(result).toBe('Rare');
        });

        it('should return "Legendary" for LEGENDARY rarity', () => {
            const result = fishingService.getRarityName(Rarity.LEGENDARY);
            expect(result).toBe('Legendary');
        });

        it('should return "Unknown" for invalid rarity', () => {
            const result = fishingService.getRarityName(999 as Rarity);
            expect(result).toBe('Unknown');
        });

        it('should return "Unknown" for negative rarity', () => {
            const result = fishingService.getRarityName(-1 as Rarity);
            expect(result).toBe('Unknown');
        });

        it('should handle numeric value 0 (COMMON)', () => {
            const result = fishingService.getRarityName(0);
            expect(result).toBe('Common');
        });

        it('should handle numeric value 1 (UNCOMMON)', () => {
            const result = fishingService.getRarityName(1);
            expect(result).toBe('Uncommon');
        });

        it('should handle numeric value 2 (RARE)', () => {
            const result = fishingService.getRarityName(2);
            expect(result).toBe('Rare');
        });

        it('should handle numeric value 3 (LEGENDARY)', () => {
            const result = fishingService.getRarityName(3);
            expect(result).toBe('Legendary');
        });
    });

    describe('getRarityColor', () => {
        it('should return gray color for COMMON rarity', () => {
            const result = fishingService.getRarityColor(Rarity.COMMON);
            expect(result).toBe(0x95a5a6);
        });

        it('should return green color for UNCOMMON rarity', () => {
            const result = fishingService.getRarityColor(Rarity.UNCOMMON);
            expect(result).toBe(0x2ecc71);
        });

        it('should return blue color for RARE rarity', () => {
            const result = fishingService.getRarityColor(Rarity.RARE);
            expect(result).toBe(0x3498db);
        });

        it('should return gold color for LEGENDARY rarity', () => {
            const result = fishingService.getRarityColor(Rarity.LEGENDARY);
            expect(result).toBe(0xf39c12);
        });

        it('should return black color for invalid rarity', () => {
            const result = fishingService.getRarityColor(999 as Rarity);
            expect(result).toBe(0x000000);
        });

        it('should return black color for negative rarity', () => {
            const result = fishingService.getRarityColor(-1 as Rarity);
            expect(result).toBe(0x000000);
        });

        it('should handle numeric value 0 (COMMON)', () => {
            const result = fishingService.getRarityColor(0);
            expect(result).toBe(0x95a5a6);
        });

        it('should handle numeric value 1 (UNCOMMON)', () => {
            const result = fishingService.getRarityColor(1);
            expect(result).toBe(0x2ecc71);
        });

        it('should handle numeric value 2 (RARE)', () => {
            const result = fishingService.getRarityColor(2);
            expect(result).toBe(0x3498db);
        });

        it('should handle numeric value 3 (LEGENDARY)', () => {
            const result = fishingService.getRarityColor(3);
            expect(result).toBe(0xf39c12);
        });

        it('should return valid hex color values', () => {
            const colors = [
                fishingService.getRarityColor(Rarity.COMMON),
                fishingService.getRarityColor(Rarity.UNCOMMON),
                fishingService.getRarityColor(Rarity.RARE),
                fishingService.getRarityColor(Rarity.LEGENDARY),
            ];

            colors.forEach(color => {
                expect(color).toBeGreaterThanOrEqual(0);
                expect(color).toBeLessThanOrEqual(0xffffff);
            });
        });
    });

    describe('getCurrentTimeOfDay', () => {
        // Test Dawn period (5:00-6:59)
        it('should return DAWN for hour 5', () => {
            const result = fishingService.getCurrentTimeOfDay(5);
            expect(result).toBe(TimeOfDay.DAWN);
        });

        it('should return DAWN for hour 6', () => {
            const result = fishingService.getCurrentTimeOfDay(6);
            expect(result).toBe(TimeOfDay.DAWN);
        });

        // Test Day period (7:00-17:59)
        it('should return DAY for hour 7 (edge case)', () => {
            const result = fishingService.getCurrentTimeOfDay(7);
            expect(result).toBe(TimeOfDay.DAY);
        });

        it('should return DAY for hour 12 (midday)', () => {
            const result = fishingService.getCurrentTimeOfDay(12);
            expect(result).toBe(TimeOfDay.DAY);
        });

        it('should return DAY for hour 17', () => {
            const result = fishingService.getCurrentTimeOfDay(17);
            expect(result).toBe(TimeOfDay.DAY);
        });

        // Test Dusk period (18:00-19:59)
        it('should return DUSK for hour 18 (edge case)', () => {
            const result = fishingService.getCurrentTimeOfDay(18);
            expect(result).toBe(TimeOfDay.DUSK);
        });

        it('should return DUSK for hour 19', () => {
            const result = fishingService.getCurrentTimeOfDay(19);
            expect(result).toBe(TimeOfDay.DUSK);
        });

        // Test Night period (20:00-4:59)
        it('should return NIGHT for hour 20 (edge case)', () => {
            const result = fishingService.getCurrentTimeOfDay(20);
            expect(result).toBe(TimeOfDay.NIGHT);
        });

        it('should return NIGHT for hour 23', () => {
            const result = fishingService.getCurrentTimeOfDay(23);
            expect(result).toBe(TimeOfDay.NIGHT);
        });

        it('should return NIGHT for hour 0 (midnight)', () => {
            const result = fishingService.getCurrentTimeOfDay(0);
            expect(result).toBe(TimeOfDay.NIGHT);
        });

        it('should return NIGHT for hour 4', () => {
            const result = fishingService.getCurrentTimeOfDay(4);
            expect(result).toBe(TimeOfDay.NIGHT);
        });

        // Test boundary conditions
        it('should handle all 24 hours correctly', () => {
            const expected = [
                TimeOfDay.NIGHT, // 0
                TimeOfDay.NIGHT, // 1
                TimeOfDay.NIGHT, // 2
                TimeOfDay.NIGHT, // 3
                TimeOfDay.NIGHT, // 4
                TimeOfDay.DAWN,  // 5
                TimeOfDay.DAWN,  // 6
                TimeOfDay.DAY,   // 7
                TimeOfDay.DAY,   // 8
                TimeOfDay.DAY,   // 9
                TimeOfDay.DAY,   // 10
                TimeOfDay.DAY,   // 11
                TimeOfDay.DAY,   // 12
                TimeOfDay.DAY,   // 13
                TimeOfDay.DAY,   // 14
                TimeOfDay.DAY,   // 15
                TimeOfDay.DAY,   // 16
                TimeOfDay.DAY,   // 17
                TimeOfDay.DUSK,  // 18
                TimeOfDay.DUSK,  // 19
                TimeOfDay.NIGHT, // 20
                TimeOfDay.NIGHT, // 21
                TimeOfDay.NIGHT, // 22
                TimeOfDay.NIGHT, // 23
            ];

            for (let hour = 0; hour < 24; hour++) {
                expect(fishingService.getCurrentTimeOfDay(hour)).toBe(expected[hour]);
            }
        });

        it('should use current UTC hour when no parameter provided', () => {
            // Just verify it returns a valid TimeOfDay value
            const result = fishingService.getCurrentTimeOfDay();
            expect(Object.values(TimeOfDay)).toContain(result);
        });
    });

    describe('getTimeOfDayName', () => {
        it('should return "Day" for DAY', () => {
            const result = fishingService.getTimeOfDayName(TimeOfDay.DAY);
            expect(result).toBe('Day');
        });

        it('should return "Night" for NIGHT', () => {
            const result = fishingService.getTimeOfDayName(TimeOfDay.NIGHT);
            expect(result).toBe('Night');
        });

        it('should return "Dawn" for DAWN', () => {
            const result = fishingService.getTimeOfDayName(TimeOfDay.DAWN);
            expect(result).toBe('Dawn');
        });

        it('should return "Dusk" for DUSK', () => {
            const result = fishingService.getTimeOfDayName(TimeOfDay.DUSK);
            expect(result).toBe('Dusk');
        });

        it('should return "Any Time" for ANY', () => {
            const result = fishingService.getTimeOfDayName(TimeOfDay.ANY);
            expect(result).toBe('Any Time');
        });

        it('should return "Unknown" for invalid value', () => {
            const result = fishingService.getTimeOfDayName('INVALID' as TimeOfDay);
            expect(result).toBe('Unknown');
        });
    });

    describe('getTimeOfDayEmoji', () => {
        it('should return sun emoji for DAY', () => {
            const result = fishingService.getTimeOfDayEmoji(TimeOfDay.DAY);
            expect(result).toBe('☀️');
        });

        it('should return moon emoji for NIGHT', () => {
            const result = fishingService.getTimeOfDayEmoji(TimeOfDay.NIGHT);
            expect(result).toBe('🌙');
        });

        it('should return sunrise emoji for DAWN', () => {
            const result = fishingService.getTimeOfDayEmoji(TimeOfDay.DAWN);
            expect(result).toBe('🌅');
        });

        it('should return sunset emoji for DUSK', () => {
            const result = fishingService.getTimeOfDayEmoji(TimeOfDay.DUSK);
            expect(result).toBe('🌆');
        });

        it('should return clock emoji for ANY', () => {
            const result = fishingService.getTimeOfDayEmoji(TimeOfDay.ANY);
            expect(result).toBe('🕐');
        });

        it('should return question mark emoji for invalid value', () => {
            const result = fishingService.getTimeOfDayEmoji('INVALID' as TimeOfDay);
            expect(result).toBe('❓');
        });

        it('should return valid emoji strings for all TimeOfDay values', () => {
            const emojis = [
                fishingService.getTimeOfDayEmoji(TimeOfDay.DAY),
                fishingService.getTimeOfDayEmoji(TimeOfDay.NIGHT),
                fishingService.getTimeOfDayEmoji(TimeOfDay.DAWN),
                fishingService.getTimeOfDayEmoji(TimeOfDay.DUSK),
                fishingService.getTimeOfDayEmoji(TimeOfDay.ANY),
            ];

            emojis.forEach(emoji => {
                expect(emoji).toBeTruthy();
                expect(typeof emoji).toBe('string');
                expect(emoji.length).toBeGreaterThan(0);
            });
        });
    });
});
