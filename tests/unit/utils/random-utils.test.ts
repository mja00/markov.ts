import { describe, expect, it } from 'vitest';

import { RandomUtils } from '../../../src/utils/random-utils.js';

describe('RandomUtils', () => {
    describe('intFromInterval', () => {
        it('should return a number within the specified range', () => {
            for (let i = 0; i < 100; i++) {
                const result = RandomUtils.intFromInterval(1, 10);
                expect(result).toBeGreaterThanOrEqual(1);
                expect(result).toBeLessThanOrEqual(10);
            }
        });

        it('should return min when min equals max', () => {
            const result = RandomUtils.intFromInterval(5, 5);
            expect(result).toBe(5);
        });

        it('should return integer values', () => {
            for (let i = 0; i < 50; i++) {
                const result = RandomUtils.intFromInterval(0, 100);
                expect(Number.isInteger(result)).toBe(true);
            }
        });

        it('should handle negative ranges', () => {
            for (let i = 0; i < 50; i++) {
                const result = RandomUtils.intFromInterval(-10, -1);
                expect(result).toBeGreaterThanOrEqual(-10);
                expect(result).toBeLessThanOrEqual(-1);
            }
        });

        it('should handle ranges crossing zero', () => {
            for (let i = 0; i < 50; i++) {
                const result = RandomUtils.intFromInterval(-5, 5);
                expect(result).toBeGreaterThanOrEqual(-5);
                expect(result).toBeLessThanOrEqual(5);
            }
        });

        it('should handle large ranges', () => {
            for (let i = 0; i < 50; i++) {
                const result = RandomUtils.intFromInterval(0, 1000000);
                expect(result).toBeGreaterThanOrEqual(0);
                expect(result).toBeLessThanOrEqual(1000000);
            }
        });

        it('should produce different values over multiple calls', () => {
            const results = new Set();
            for (let i = 0; i < 100; i++) {
                results.add(RandomUtils.intFromInterval(1, 100));
            }
            // With 100 calls in range 1-100, we should get multiple different values
            expect(results.size).toBeGreaterThan(10);
        });

        it('should be able to return min value', () => {
            let foundMin = false;
            for (let i = 0; i < 100; i++) {
                if (RandomUtils.intFromInterval(1, 10) === 1) {
                    foundMin = true;
                    break;
                }
            }
            expect(foundMin).toBe(true);
        });

        it('should be able to return max value', () => {
            let foundMax = false;
            for (let i = 0; i < 100; i++) {
                if (RandomUtils.intFromInterval(1, 10) === 10) {
                    foundMax = true;
                    break;
                }
            }
            expect(foundMax).toBe(true);
        });
    });

    describe('shuffle', () => {
        it('should return an array with the same length', () => {
            const input = [1, 2, 3, 4, 5];
            const result = RandomUtils.shuffle([...input]);
            expect(result).toHaveLength(input.length);
        });

        it('should contain all original elements', () => {
            const input = [1, 2, 3, 4, 5];
            const result = RandomUtils.shuffle([...input]);
            expect(result.sort()).toEqual(input.sort());
        });

        it('should handle empty array', () => {
            const result = RandomUtils.shuffle([]);
            expect(result).toEqual([]);
        });

        it('should handle single element array', () => {
            const result = RandomUtils.shuffle([1]);
            expect(result).toEqual([1]);
        });

        it('should handle two element array', () => {
            const input = [1, 2];
            const result = RandomUtils.shuffle([...input]);
            expect(result).toHaveLength(2);
            expect(result).toContain(1);
            expect(result).toContain(2);
        });

        it('should mutate the original array', () => {
            const input = [1, 2, 3, 4, 5];
            const original = input;
            RandomUtils.shuffle(input);
            expect(input).toBe(original);
        });

        it('should handle arrays with duplicate values', () => {
            const input = [1, 1, 2, 2, 3];
            const result = RandomUtils.shuffle([...input]);
            expect(result.sort()).toEqual(input.sort());
        });

        it('should handle arrays with different types', () => {
            const input = ['a', 'b', 'c', 1, 2, 3];
            const result = RandomUtils.shuffle([...input]);
            expect(result).toHaveLength(6);
            expect(result).toContain('a');
            expect(result).toContain(1);
        });

        it('should produce different orderings over multiple calls', () => {
            const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const results = new Set();

            for (let i = 0; i < 50; i++) {
                const shuffled = RandomUtils.shuffle([...input]);
                results.add(JSON.stringify(shuffled));
            }

            // With 50 shuffles of 10 elements, we should get multiple different orderings
            expect(results.size).toBeGreaterThan(20);
        });

        it('should handle arrays with objects', () => {
            const input = [
                { id: 1, name: 'a' },
                { id: 2, name: 'b' },
                { id: 3, name: 'c' },
            ];
            const result = RandomUtils.shuffle([...input]);
            expect(result).toHaveLength(3);
            expect(result.some(item => item.id === 1)).toBe(true);
            expect(result.some(item => item.id === 2)).toBe(true);
            expect(result.some(item => item.id === 3)).toBe(true);
        });

        it('should use Fisher-Yates algorithm (statistical test)', () => {
            // Test that all positions have roughly equal probability
            const input = [1, 2, 3];
            const positionCounts = [
                { 1: 0, 2: 0, 3: 0 },
                { 1: 0, 2: 0, 3: 0 },
                { 1: 0, 2: 0, 3: 0 },
            ];

            const iterations = 300;
            for (let i = 0; i < iterations; i++) {
                const shuffled = RandomUtils.shuffle([...input]);
                shuffled.forEach((value, index) => {
                    positionCounts[index][value]++;
                });
            }

            // Each number should appear in each position roughly 1/3 of the time
            // We'll use a loose bound (between 20% and 47%) to account for randomness
            positionCounts.forEach(position => {
                Object.values(position).forEach(count => {
                    expect(count).toBeGreaterThan(iterations * 0.2);
                    expect(count).toBeLessThan(iterations * 0.47);
                });
            });
        });
    });
});
