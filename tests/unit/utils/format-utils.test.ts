import { Locale } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { FormatUtils } from '../../../src/utils/format-utils.js';

describe('FormatUtils', () => {
    describe('channelMention', () => {
        it('should format channel mention correctly', () => {
            const result = FormatUtils.channelMention('123456789012345678');
            expect(result).toBe('<#123456789012345678>');
        });

        it('should handle different channel IDs', () => {
            const result = FormatUtils.channelMention('987654321098765432');
            expect(result).toBe('<#987654321098765432>');
        });

        it('should handle short ID', () => {
            const result = FormatUtils.channelMention('123');
            expect(result).toBe('<#123>');
        });

        it('should handle empty string', () => {
            const result = FormatUtils.channelMention('');
            expect(result).toBe('<#>');
        });
    });

    describe('userMention', () => {
        it('should format user mention correctly', () => {
            const result = FormatUtils.userMention('123456789012345678');
            expect(result).toBe('<@!123456789012345678>');
        });

        it('should handle different user IDs', () => {
            const result = FormatUtils.userMention('987654321098765432');
            expect(result).toBe('<@!987654321098765432>');
        });

        it('should handle short ID', () => {
            const result = FormatUtils.userMention('123');
            expect(result).toBe('<@!123>');
        });

        it('should handle empty string', () => {
            const result = FormatUtils.userMention('');
            expect(result).toBe('<@!>');
        });
    });

    describe('duration', () => {
        it('should format seconds correctly', () => {
            const result = FormatUtils.duration(5000, Locale.EnglishUS);
            expect(result).toContain('5');
            expect(result.toLowerCase()).toContain('second');
        });

        it('should format minutes correctly', () => {
            const result = FormatUtils.duration(120000, Locale.EnglishUS);
            expect(result).toContain('2');
            expect(result.toLowerCase()).toContain('minute');
        });

        it('should format hours correctly', () => {
            const result = FormatUtils.duration(3600000, Locale.EnglishUS);
            expect(result).toContain('1');
            expect(result.toLowerCase()).toContain('hour');
        });

        it('should format days correctly', () => {
            const result = FormatUtils.duration(86400000, Locale.EnglishUS);
            expect(result).toContain('1');
            expect(result.toLowerCase()).toContain('day');
        });

        it('should format mixed duration correctly', () => {
            // 1 hour, 30 minutes, 45 seconds
            const result = FormatUtils.duration(5445000, Locale.EnglishUS);
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);
        });

        it('should handle zero milliseconds', () => {
            const result = FormatUtils.duration(0, Locale.EnglishUS);
            // Zero duration returns empty string from luxon
            expect(result).toBe('');
        });

        it('should handle very large durations', () => {
            // 365 days
            const result = FormatUtils.duration(31536000000, Locale.EnglishUS);
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);
        });

        it('should handle different locales', () => {
            const resultEN = FormatUtils.duration(5000, Locale.EnglishUS);
            const resultES = FormatUtils.duration(5000, Locale.SpanishES);
            expect(resultEN).toBeTruthy();
            expect(resultES).toBeTruthy();
            // Note: The actual format may differ between locales
        });
    });

    describe('fileSize', () => {
        it('should format bytes correctly', () => {
            const result = FormatUtils.fileSize(512);
            expect(result).toContain('512');
            expect(result).toContain('B');
        });

        it('should format kilobytes correctly', () => {
            const result = FormatUtils.fileSize(1024);
            expect(result).toContain('kB');
        });

        it('should format megabytes correctly', () => {
            const result = FormatUtils.fileSize(1048576);
            expect(result).toContain('MB');
        });

        it('should format gigabytes correctly', () => {
            const result = FormatUtils.fileSize(1073741824);
            expect(result).toContain('GB');
        });

        it('should handle zero bytes', () => {
            const result = FormatUtils.fileSize(0);
            expect(result).toContain('0');
            expect(result).toContain('B');
        });

        it('should handle large file sizes', () => {
            const result = FormatUtils.fileSize(1099511627776); // 1 TB
            expect(result).toContain('TB');
        });

        it('should round to 2 decimal places', () => {
            const result = FormatUtils.fileSize(1536); // 1.5 KB
            expect(result).toBeTruthy();
            // filesize library with round: 2 should limit decimal places
        });

        it('should handle fractional bytes', () => {
            const result = FormatUtils.fileSize(1536);
            expect(result).toContain('kB');
        });
    });
});
