import { describe, expect, it } from 'vitest';

import { resolveReplyBudget } from '../../../src/services/reply-budget.js';

describe('resolveReplyBudget', () => {
	it('clamps out-of-range values and never wraps up after the hard timeout', () => {
		expect(resolveReplyBudget({
			maxToolRounds: 0,
			maxOutputTokens: 10_000_000,
			wrapUpAfterMs: 200000,
			timeoutMs: 60000,
		})).toEqual({
			maxToolRounds: 1,
			maxOutputTokens: 1_000_000,
			wrapUpAfterMs: 60000,
			timeoutMs: 60000,
		});
	});

	it('wraps up at half of a short timeout when wrapUpAfterMs is omitted', () => {
		expect(resolveReplyBudget({ timeoutMs: 60000 }).wrapUpAfterMs).toBe(30000);
	});

	it('falls back to defaults for missing or non-numeric values', () => {
		expect(resolveReplyBudget({ maxToolRounds: '9' })).toEqual(resolveReplyBudget(undefined));
	});
});
