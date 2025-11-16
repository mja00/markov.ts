import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Catchable } from '../../src/db/schema.js';
import { Rarity } from '../../src/enums/rarity.js';
import { FishingService } from '../../src/services/fishing.service.js';

// Mock the database service
vi.mock('../../src/services/database.service.js', () => ({
    getDb: vi.fn(),
}));

// Mock the logger
vi.mock('../../src/services/logger.js', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

describe('FishingService Integration Tests', () => {
    let fishingService: FishingService;
    let mockDb: any;

    beforeEach(async () => {
        // Reset mocks before each test
        vi.clearAllMocks();

        // Create mock database
        mockDb = {
            select: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
        };

        // Import and mock getDb
        const { getDb } = await import('../../src/services/database.service.js');
        vi.mocked(getDb).mockReturnValue(mockDb);

        fishingService = new FishingService();
    });

    describe('pickCatchableByRarity', () => {
        it('should pick a random catchable from available options', async () => {
            const mockCatchable: Catchable = {
                id: '1',
                name: 'Common Fish 1',
                rarity: Rarity.COMMON,
                worth: 10,
                image: '🐟',
                firstCaughtBy: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                timeOfDay: null,
            };

            // Mock the database query to return a single catchable (LIMIT 1)
            // The query chain is: select().from().where().orderBy().limit()
            mockDb.limit.mockResolvedValue([mockCatchable]);

            const result = await fishingService.pickCatchableByRarity(Rarity.COMMON);

            expect(result).toBeDefined();
            expect(result).toEqual(mockCatchable);
            expect(result?.rarity).toBe(Rarity.COMMON);
        });

        it('should return null when no catchables are found', async () => {
            // Mock the database query to return empty array
            // The query chain is: select().from().where().orderBy().limit()
            mockDb.limit.mockResolvedValue([]);

            const result = await fishingService.pickCatchableByRarity(Rarity.LEGENDARY);

            expect(result).toBeNull();
        });

        it('should pick different catchables from a pool', async () => {
            const mockCatchables: Catchable[] = Array.from({ length: 10 }, (_, i) => ({
                id: `${i + 1}`,
                name: `Fish ${i + 1}`,
                rarity: Rarity.UNCOMMON,
                worth: (i + 1) * 10,
                image: '🐟',
                firstCaughtBy: null,
                timeOfDay: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            }));

            // Mock to return one random catchable per call (simulating RANDOM() LIMIT 1)
            // The query chain is: select().from().where().orderBy().limit()
            mockDb.limit.mockImplementation(() => {
                const randomIndex = Math.floor(Math.random() * mockCatchables.length);
                return Promise.resolve([mockCatchables[randomIndex]]);
            });

            // Pick multiple catchables
            const picks = await Promise.all(
                Array.from({ length: 20 }, () =>
                    fishingService.pickCatchableByRarity(Rarity.UNCOMMON)
                )
            );

            // All picks should be valid catchables
            picks.forEach(pick => {
                expect(pick).toBeDefined();
                expect(mockCatchables).toContainEqual(pick);
            });

            // With 20 picks from 10 options, we should get some variety
            const uniqueIds = new Set(picks.map(p => p?.id));
            expect(uniqueIds.size).toBeGreaterThan(1);
        });

        it('should handle database errors gracefully', async () => {
            // Mock a database error - can occur at any point in the query chain
            mockDb.limit.mockRejectedValue(new Error('Database connection failed'));

            await expect(
                fishingService.pickCatchableByRarity(Rarity.RARE)
            ).rejects.toThrow('Failed to pick catchable');
        });
    });

    describe('isFirstCatch', () => {
        it('should return true when catchable has never been caught', async () => {
            const mockCatchables = [
                {
                    id: '1',
                    firstCaughtBy: null,
                },
            ];

            mockDb.limit.mockResolvedValue(mockCatchables);

            const result = await fishingService.isFirstCatch('1');

            expect(result).toBe(true);
        });

        it('should return false when catchable has already been caught', async () => {
            // Empty array means the catchable either doesn't exist or has already been caught
            mockDb.limit.mockResolvedValue([]);

            const result = await fishingService.isFirstCatch('1');

            expect(result).toBe(false);
        });

        it('should handle database errors', async () => {
            mockDb.limit.mockRejectedValue(new Error('Database error'));

            await expect(fishingService.isFirstCatch('1')).rejects.toThrow(
                'Failed to check first catch'
            );
        });
    });

    describe('determineRarity (without user effects)', () => {
        it('should return a valid rarity', async () => {
            // Test multiple times to account for randomness
            const results = await Promise.all(
                Array.from({ length: 100 }, () => fishingService.determineRarity())
            );

            results.forEach(rarity => {
                expect([
                    Rarity.COMMON,
                    Rarity.UNCOMMON,
                    Rarity.RARE,
                    Rarity.LEGENDARY,
                ]).toContain(rarity);
            });
        });

        it('should produce common rarity most frequently', async () => {
            const results = await Promise.all(
                Array.from({ length: 1000 }, () => fishingService.determineRarity())
            );

            const commonCount = results.filter(r => r === Rarity.COMMON).length;
            const uncommonCount = results.filter(r => r === Rarity.UNCOMMON).length;
            const rareCount = results.filter(r => r === Rarity.RARE).length;
            const legendaryCount = results.filter(r => r === Rarity.LEGENDARY).length;

            // With 1000 rolls, we expect roughly 60% common, 30% uncommon, 8% rare, 2% legendary
            // Use loose bounds to account for randomness
            expect(commonCount).toBeGreaterThan(500); // Should be around 600
            expect(uncommonCount).toBeGreaterThan(200); // Should be around 300
            expect(rareCount).toBeGreaterThan(30); // Should be around 80
            expect(legendaryCount).toBeGreaterThan(0); // Should be around 20

            // Common should be more frequent than uncommon
            expect(commonCount).toBeGreaterThan(uncommonCount);
            expect(uncommonCount).toBeGreaterThan(rareCount);
            expect(rareCount).toBeGreaterThan(legendaryCount);
        });
    });

    describe('calculateFinalWorth (without user effects)', () => {
        it('should return base worth when no user ID is provided', async () => {
            const baseWorth = 100;
            const result = await fishingService.calculateFinalWorth(baseWorth);

            expect(result).toBe(baseWorth);
        });

        it('should handle zero base worth', async () => {
            const result = await fishingService.calculateFinalWorth(0);

            expect(result).toBe(0);
        });

        it('should handle large base worth values', async () => {
            const baseWorth = 1000000;
            const result = await fishingService.calculateFinalWorth(baseWorth);

            expect(result).toBe(baseWorth);
        });
    });
});
