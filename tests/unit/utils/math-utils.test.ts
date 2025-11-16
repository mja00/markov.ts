import { describe, expect, it } from 'vitest';

import { MathUtils } from '../../../src/utils/math-utils.js';

describe('MathUtils', () => {
    describe('sum', () => {
        it('should return 0 for empty array', () => {
            expect(MathUtils.sum([])).toBe(0);
        });

        it('should return the number itself for single element array', () => {
            expect(MathUtils.sum([5])).toBe(5);
        });

        it('should sum positive numbers correctly', () => {
            expect(MathUtils.sum([1, 2, 3, 4, 5])).toBe(15);
        });

        it('should sum negative numbers correctly', () => {
            expect(MathUtils.sum([-1, -2, -3])).toBe(-6);
        });

        it('should sum mixed positive and negative numbers', () => {
            expect(MathUtils.sum([10, -5, 3, -2])).toBe(6);
        });
        
        it('should handle decimal numbers', () => {
            expect(MathUtils.sum([1.5, 2.5, 3.0])).toBe(7);
        });

        it('should handle zero values', () => {
            expect(MathUtils.sum([0, 0, 0])).toBe(0);
        });
    });

    describe('clamp', () => {
        it('should return min when input is below min', () => {
            expect(MathUtils.clamp(5, 10, 20)).toBe(10);
        });

        it('should return max when input is above max', () => {
            expect(MathUtils.clamp(25, 10, 20)).toBe(20);
        });

        it('should return input when within range', () => {
            expect(MathUtils.clamp(15, 10, 20)).toBe(15);
        });

        it('should return min when input equals min', () => {
            expect(MathUtils.clamp(10, 10, 20)).toBe(10);
        });

        it('should return max when input equals max', () => {
            expect(MathUtils.clamp(20, 10, 20)).toBe(20);
        });

        it('should handle negative ranges', () => {
            expect(MathUtils.clamp(-5, -10, -1)).toBe(-5);
            expect(MathUtils.clamp(-15, -10, -1)).toBe(-10);
            expect(MathUtils.clamp(0, -10, -1)).toBe(-1);
        });

        it('should handle decimal numbers', () => {
            expect(MathUtils.clamp(5.5, 1.0, 10.0)).toBe(5.5);
            expect(MathUtils.clamp(0.5, 1.0, 10.0)).toBe(1.0);
        });

        it('should handle zero in range', () => {
            expect(MathUtils.clamp(0, -5, 5)).toBe(0);
        });
    });

    describe('range', () => {
        it('should generate range starting from 0', () => {
            expect(MathUtils.range(0, 5)).toEqual([0, 1, 2, 3, 4]);
        });

        it('should generate range starting from positive number', () => {
            expect(MathUtils.range(5, 3)).toEqual([5, 6, 7]);
        });

        it('should generate range starting from negative number', () => {
            expect(MathUtils.range(-3, 4)).toEqual([-3, -2, -1, 0]);
        });

        it('should return empty array for size 0', () => {
            expect(MathUtils.range(0, 0)).toEqual([]);
        });

        it('should generate single element for size 1', () => {
            expect(MathUtils.range(10, 1)).toEqual([10]);
        });

        it('should generate large ranges', () => {
            const result = MathUtils.range(0, 100);
            expect(result).toHaveLength(100);
            expect(result[0]).toBe(0);
            expect(result[99]).toBe(99);
        });
    });

    describe('ceilToMultiple', () => {
        it('should round up to nearest multiple', () => {
            expect(MathUtils.ceilToMultiple(13, 5)).toBe(15);
        });

        it('should return same value if already multiple', () => {
            expect(MathUtils.ceilToMultiple(15, 5)).toBe(15);
        });

        it('should handle multiple of 1', () => {
            expect(MathUtils.ceilToMultiple(13.7, 1)).toBe(14);
        });

        it('should handle multiple of 10', () => {
            expect(MathUtils.ceilToMultiple(23, 10)).toBe(30);
            expect(MathUtils.ceilToMultiple(20, 10)).toBe(20);
        });

        it('should handle decimal inputs', () => {
            expect(MathUtils.ceilToMultiple(12.3, 5)).toBe(15);
        });

        it('should handle zero input', () => {
            expect(MathUtils.ceilToMultiple(0, 5)).toBe(0);
        });

        it('should handle large multiples', () => {
            expect(MathUtils.ceilToMultiple(150, 100)).toBe(200);
            expect(MathUtils.ceilToMultiple(100, 100)).toBe(100);
        });

        it('should handle small multiples', () => {
            expect(MathUtils.ceilToMultiple(1.1, 0.5)).toBe(1.5);
        });
    });
});
