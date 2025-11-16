import { describe, expect, it } from 'vitest';

import { RegexUtils } from '../../../src/utils/regex-utils.js';

describe('RegexUtils', () => {
    describe('regex', () => {
        it('should parse simple regex pattern', () => {
            const result = RegexUtils.regex('/test/');
            expect(result).toBeInstanceOf(RegExp);
            expect(result?.source).toBe('test');
            expect(result?.flags).toBe('');
        });

        it('should parse regex with flags', () => {
            const result = RegexUtils.regex('/test/gi');
            expect(result).toBeInstanceOf(RegExp);
            expect(result?.source).toBe('test');
            expect(result?.flags).toBe('gi');
        });

        it('should parse regex with multiple flags', () => {
            const result = RegexUtils.regex('/hello world/gim');
            expect(result).toBeInstanceOf(RegExp);
            expect(result?.source).toBe('hello world');
            expect(result?.flags).toBe('gim');
        });

        it('should parse complex regex pattern', () => {
            const result = RegexUtils.regex('/\\d{3}-\\d{4}/');
            expect(result).toBeInstanceOf(RegExp);
            expect(result?.source).toBe('\\d{3}-\\d{4}');
        });

        it('should return undefined for invalid pattern (no slashes)', () => {
            const result = RegexUtils.regex('test');
            expect(result).toBeUndefined();
        });

        it('should return undefined for pattern with only one slash', () => {
            const result = RegexUtils.regex('/test');
            expect(result).toBeUndefined();
        });

        it('should handle empty pattern', () => {
            const result = RegexUtils.regex('//');
            expect(result).toBeInstanceOf(RegExp);
            expect(result?.source).toBe('(?:)');
        });

        it('should handle pattern with special characters', () => {
            const result = RegexUtils.regex('/[a-z]+@[a-z]+\\.[a-z]+/i');
            expect(result).toBeInstanceOf(RegExp);
            expect(result?.flags).toBe('i');
        });

        it('should handle pattern with forward slashes in it', () => {
            const result = RegexUtils.regex('/http:\\/\\/example\\.com/');
            expect(result).toBeInstanceOf(RegExp);
            expect(result?.source).toBe('http:\\/\\/example\\.com');
        });
    });

    describe('escapeRegex', () => {
        it('should escape special regex characters', () => {
            const result = RegexUtils.escapeRegex('test.*');
            expect(result).toBe('test\\.\\*');
        });

        it('should escape brackets', () => {
            const result = RegexUtils.escapeRegex('[test]');
            expect(result).toBe('\\[test\\]');
        });

        it('should escape parentheses', () => {
            const result = RegexUtils.escapeRegex('(test)');
            expect(result).toBe('\\(test\\)');
        });

        it('should escape curly braces', () => {
            const result = RegexUtils.escapeRegex('{test}');
            expect(result).toBe('\\{test\\}');
        });

        it('should escape plus and asterisk', () => {
            const result = RegexUtils.escapeRegex('test+*');
            expect(result).toBe('test\\+\\*');
        });

        it('should escape question mark and dot', () => {
            const result = RegexUtils.escapeRegex('test?.com');
            expect(result).toBe('test\\?\\.com');
        });

        it('should escape caret and dollar', () => {
            const result = RegexUtils.escapeRegex('^test$');
            expect(result).toBe('\\^test\\$');
        });

        it('should escape pipe and backslash', () => {
            const result = RegexUtils.escapeRegex('test|\\path');
            expect(result).toBe('test\\|\\\\path');
        });

        it('should escape hyphen', () => {
            const result = RegexUtils.escapeRegex('test-case');
            expect(result).toBe('test\\-case');
        });

        it('should escape hash symbol', () => {
            const result = RegexUtils.escapeRegex('#hashtag');
            expect(result).toBe('\\#hashtag');
        });

        it('should escape whitespace', () => {
            const result = RegexUtils.escapeRegex('hello world');
            expect(result).toBe('hello\\ world');
        });

        it('should handle plain text without special chars', () => {
            const result = RegexUtils.escapeRegex('hello');
            expect(result).toBe('hello');
        });

        it('should handle empty string', () => {
            const result = RegexUtils.escapeRegex('');
            expect(result).toBe('');
        });

        it('should escape all special chars together', () => {
            const result = RegexUtils.escapeRegex('[test.*+?^$]');
            expect(result).toBe('\\[test\\.\\*\\+\\?\\^\\$\\]');
        });

        it('should handle undefined input', () => {
            const result = RegexUtils.escapeRegex(undefined as any);
            expect(result).toBeUndefined();
        });

        it('should handle null input', () => {
            const result = RegexUtils.escapeRegex(null as any);
            expect(result).toBeUndefined();
        });
    });

    describe('discordId', () => {
        it('should extract valid Discord ID (17 digits)', () => {
            const result = RegexUtils.discordId('12345678901234567');
            expect(result).toBe('12345678901234567');
        });

        it('should extract valid Discord ID (18 digits)', () => {
            const result = RegexUtils.discordId('123456789012345678');
            expect(result).toBe('123456789012345678');
        });

        it('should extract valid Discord ID (19 digits)', () => {
            const result = RegexUtils.discordId('1234567890123456789');
            expect(result).toBe('1234567890123456789');
        });

        it('should extract valid Discord ID (20 digits)', () => {
            const result = RegexUtils.discordId('12345678901234567890');
            expect(result).toBe('12345678901234567890');
        });

        it('should extract ID from text', () => {
            const result = RegexUtils.discordId('User ID: 123456789012345678');
            expect(result).toBe('123456789012345678');
        });

        it('should extract ID from Discord mention format', () => {
            const result = RegexUtils.discordId('<@!123456789012345678>');
            expect(result).toBe('123456789012345678');
        });

        it('should extract ID from channel mention', () => {
            const result = RegexUtils.discordId('<#123456789012345678>');
            expect(result).toBe('123456789012345678');
        });

        it('should return undefined for short number (16 digits)', () => {
            const result = RegexUtils.discordId('1234567890123456');
            expect(result).toBeUndefined();
        });

        it('should return undefined for long number (21 digits)', () => {
            const result = RegexUtils.discordId('123456789012345678901');
            expect(result).toBeUndefined();
        });

        it('should return undefined for non-numeric text', () => {
            const result = RegexUtils.discordId('not a discord id');
            expect(result).toBeUndefined();
        });

        it('should return undefined for empty string', () => {
            const result = RegexUtils.discordId('');
            expect(result).toBeUndefined();
        });

        it('should handle undefined input', () => {
            const result = RegexUtils.discordId(undefined as any);
            expect(result).toBeUndefined();
        });

        it('should handle null input', () => {
            const result = RegexUtils.discordId(null as any);
            expect(result).toBeUndefined();
        });

        it('should extract first ID when multiple are present', () => {
            const result = RegexUtils.discordId('123456789012345678 and 987654321098765432');
            expect(result).toBe('123456789012345678');
        });
    });

    describe('tag', () => {
        it('should parse valid Discord tag', () => {
            const result = RegexUtils.tag('username#1234');
            expect(result).toEqual({
                tag: 'username#1234',
                username: 'username',
                discriminator: '1234',
            });
        });

        it('should parse tag with complex username', () => {
            const result = RegexUtils.tag('User Name 123#5678');
            expect(result).toEqual({
                tag: 'User Name 123#5678',
                username: 'User Name 123',
                discriminator: '5678',
            });
        });

        it('should parse tag with special characters in username', () => {
            const result = RegexUtils.tag('user_name-123#9999');
            expect(result).toEqual({
                tag: 'user_name-123#9999',
                username: 'user_name-123',
                discriminator: '9999',
            });
        });

        it('should parse tag with minimum discriminator (0000)', () => {
            const result = RegexUtils.tag('user#0000');
            expect(result).toEqual({
                tag: 'user#0000',
                username: 'user',
                discriminator: '0000',
            });
        });

        it('should return undefined for invalid discriminator (3 digits)', () => {
            const result = RegexUtils.tag('username#123');
            expect(result).toBeUndefined();
        });

        it('should return undefined for invalid discriminator (5 digits)', () => {
            const result = RegexUtils.tag('username#12345');
            expect(result).toBeUndefined();
        });

        it('should return undefined for missing discriminator', () => {
            const result = RegexUtils.tag('username');
            expect(result).toBeUndefined();
        });

        it('should return undefined for missing username', () => {
            const result = RegexUtils.tag('#1234');
            expect(result).toBeUndefined();
        });

        it('should return undefined for empty string', () => {
            const result = RegexUtils.tag('');
            expect(result).toBeUndefined();
        });

        it('should handle tag embedded in text', () => {
            const result = RegexUtils.tag('The user is TestUser#1234 in the server');
            // Note: The regex matches everything before #, including leading text
            expect(result).toEqual({
                tag: 'The user is TestUser#1234',
                username: 'The user is TestUser',
                discriminator: '1234',
            });
        });

        it('should parse tag with single character username', () => {
            const result = RegexUtils.tag('a#1234');
            expect(result).toEqual({
                tag: 'a#1234',
                username: 'a',
                discriminator: '1234',
            });
        });

        it('should return undefined for letters in discriminator', () => {
            const result = RegexUtils.tag('username#abcd');
            expect(result).toBeUndefined();
        });
    });
});
