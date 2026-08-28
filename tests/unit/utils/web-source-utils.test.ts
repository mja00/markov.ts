import { describe, expect, it } from 'vitest';

import {
	assembleReply,
	canonicalizeSourceUrl,
	dedupeWebSources,
	formatWebSources,
} from '../../../src/utils/web-source-utils.js';

describe('web source utilities', () => {
	it('canonicalizes safe source URLs and rejects credentials or controls', () => {
		expect(canonicalizeSourceUrl('https://example.com/article#tracking')).toBe('https://example.com/article');
		expect(canonicalizeSourceUrl('https://user:password@example.com/article')).toBeNull();
		expect(canonicalizeSourceUrl('https://example.com/article\nforged')).toBeNull();
	});

	it('deduplicates source links while preserving their first titles', () => {
		expect(dedupeWebSources([
			{ url: 'https://example.com/a#one', title: 'First' },
			{ url: 'https://example.com/a#two', title: 'Duplicate' },
			{ url: 'https://example.com/b', title: 'Second' },
		])).toEqual([
			{ url: 'https://example.com/a', title: 'First' },
			{ url: 'https://example.com/b', title: 'Second' },
		]);
	});

	it('renders markdown sources and keeps the assembled reply within Discord limits', () => {
		const sources = Array.from({ length: 5 }, (_, index) => {
			return {
				url: `https://example.com/${index}`,
				title: `Source ${index}`,
			};
		});
		const reply = assembleReply({
			modelText: 'A'.repeat(2500),
			sources,
			footer: '-# AI response',
		});

		expect(reply.length).toBeLessThanOrEqual(2000);
		expect(reply).toContain('**Sources**');
		expect(reply).toContain('[Source 0]');
	});

	it('strips markdown-sensitive title characters before rendering links', () => {
		expect(formatWebSources([{ url: 'https://example.com', title: '[unsafe]* title' }]))
			.toBe('**Sources**\n- [unsafe title](<https://example.com/>)');
	});
});
