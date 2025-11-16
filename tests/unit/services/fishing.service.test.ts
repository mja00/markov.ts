import { describe, expect, it } from 'vitest';

import { Rarity } from '../../../src/enums/rarity.js';
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
});
