import { describe, expect, it } from 'vitest';

import { StringUtils } from '../../../src/utils/string-utils.js';

describe('StringUtils', () => {
    describe('truncate', () => {
        it('should return original string if shorter than length', () => {
            expect(StringUtils.truncate('hello', 10)).toBe('hello');
        });

        it('should return original string if equal to length', () => {
            expect(StringUtils.truncate('hello', 5)).toBe('hello');
        });

        it('should truncate string if longer than length', () => {
            expect(StringUtils.truncate('hello world', 5, false)).toBe('hello');
        });

        it('should truncate with ellipsis when addEllipsis is true', () => {
            expect(StringUtils.truncate('hello world', 8, true)).toBe('hello...');
        });

        it('should handle exact length with ellipsis', () => {
            expect(StringUtils.truncate('hello', 5, true)).toBe('hello');
        });

        it('should truncate long string with ellipsis', () => {
            expect(StringUtils.truncate('this is a very long string', 10, true)).toBe('this is...');
        });

        it('should handle empty string', () => {
            expect(StringUtils.truncate('', 5)).toBe('');
        });

        it('should handle single character', () => {
            expect(StringUtils.truncate('a', 1)).toBe('a');
            expect(StringUtils.truncate('ab', 1, false)).toBe('a');
        });

        it('should handle minimum length with ellipsis', () => {
            expect(StringUtils.truncate('hello world', 3, true)).toBe('...');
        });

        it('should default addEllipsis to false', () => {
            expect(StringUtils.truncate('hello world', 5)).toBe('hello');
        });

        it('should handle unicode characters', () => {
            // Note: Emoji characters like 👋 count as 2 characters in JavaScript
            expect(StringUtils.truncate('hello 👋 world', 8, false)).toBe('hello 👋');
        });
    });

    describe('escapeMarkdown', () => {
        it('should escape asterisks', () => {
            const result = StringUtils.escapeMarkdown('*bold*');
            expect(result).toContain('\\*');
        });

        it('should escape underscores', () => {
            const result = StringUtils.escapeMarkdown('_italic_');
            expect(result).toContain('\\_');
        });

        it('should preserve custom Discord emojis', () => {
            const emoji = '<:emojiName:123456789012345678>';
            const result = StringUtils.escapeMarkdown(emoji);
            expect(result).toBe(emoji);
        });

        it('should preserve animated custom Discord emojis', () => {
            const emoji = '<a:emojiName:123456789012345678>';
            const result = StringUtils.escapeMarkdown(emoji);
            expect(result).toBe(emoji);
        });

        it('should handle escaped characters in emoji names', () => {
            const text = 'Text with <:emoji\\_name:123456789012345678> inside';
            const result = StringUtils.escapeMarkdown(text);
            // Should unescape the emoji name but keep other escapes
            expect(result).toContain('<:emoji_name:123456789012345678>');
        });

        it('should handle text without markdown', () => {
            expect(StringUtils.escapeMarkdown('plain text')).toBe('plain text');
        });

        it('should handle empty string', () => {
            expect(StringUtils.escapeMarkdown('')).toBe('');
        });

        it('should handle mixed markdown and emojis', () => {
            const text = '*bold* <:smile:123456789012345678> _italic_';
            const result = StringUtils.escapeMarkdown(text);
            expect(result).toContain('<:smile:123456789012345678>');
            expect(result).toContain('\\*');
            // Note: Discord.js escapeMarkdown behavior with underscores may vary
            // Just ensure the emoji is preserved
        });
    });

    describe('stripMarkdown', () => {
        it('should remove bold markdown', () => {
            const result = StringUtils.stripMarkdown('**bold text**');
            expect(result).not.toContain('**');
            expect(result).toContain('bold text');
        });

        it('should remove italic markdown', () => {
            const result = StringUtils.stripMarkdown('*italic text*');
            expect(result).not.toContain('*');
            expect(result).toContain('italic text');
        });

        it('should remove underline markdown', () => {
            const result = StringUtils.stripMarkdown('_underline text_');
            expect(result).not.toContain('_');
            expect(result).toContain('underline text');
        });

        it('should remove headers', () => {
            const result = StringUtils.stripMarkdown('# Header');
            expect(result).not.toContain('#');
            expect(result).toContain('Header');
        });

        it('should remove links', () => {
            const result = StringUtils.stripMarkdown('[link text](https://example.com)');
            expect(result).toContain('link text');
            expect(result).not.toContain('[');
            expect(result).not.toContain(']');
        });

        it('should remove code blocks', () => {
            const result = StringUtils.stripMarkdown('`code`');
            expect(result).not.toContain('`');
            expect(result).toContain('code');
        });

        it('should handle plain text', () => {
            expect(StringUtils.stripMarkdown('plain text')).toBe('plain text');
        });

        it('should handle empty string', () => {
            expect(StringUtils.stripMarkdown('')).toBe('');
        });

        it('should remove multiple markdown elements', () => {
            const text = '**bold** and *italic* with [link](url)';
            const result = StringUtils.stripMarkdown(text);
            expect(result).not.toContain('**');
            expect(result).not.toContain('*');
            expect(result).not.toContain('[');
            expect(result).toContain('bold');
            expect(result).toContain('italic');
            expect(result).toContain('link');
        });
    });
});
