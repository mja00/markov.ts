import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { ModerationService } from '../../../src/services/moderation.service.js';

const config = (enabled = true) => {
	return {
		enabled,
		model: 'omni-moderation-latest' as const,
		timeoutMs: 1000,
	};
};

describe('ModerationService', () => {
	it('returns allowed and flagged statuses from the moderation response', async () => {
		const create = vi.fn()
			.mockResolvedValueOnce({ results: [{ flagged: false }] })
			.mockResolvedValueOnce({ results: [{ flagged: true }] });
		const service = new ModerationService({ config: config(), client: { moderations: { create } } });

		await expect(service.moderate('safe text')).resolves.toEqual({ status: 'allowed' });
		await expect(service.moderate('unsafe text')).resolves.toEqual({ status: 'flagged' });
		expect(create).toHaveBeenCalledWith({ model: 'omni-moderation-latest', input: 'safe text' }, expect.objectContaining({ timeout: 1000 }));
	});

	it('fails closed when the provider errors or returns malformed data', async () => {
		const create = vi.fn()
			.mockRejectedValueOnce(new Error('network down'))
			.mockResolvedValueOnce({ results: [] });
		const service = new ModerationService({ config: config(), client: { moderations: { create } } });

		await expect(service.moderate('text')).resolves.toEqual({ status: 'unavailable' });
		await expect(service.moderate('text')).resolves.toEqual({ status: 'unavailable' });
	});

	it('does not call OpenAI when disabled or given empty text', async () => {
		const create = vi.fn();
		const service = new ModerationService({ config: config(false), client: { moderations: { create } } });

		await expect(service.moderate('text')).resolves.toEqual({ status: 'disabled' });
		await expect(service.moderate('   ')).resolves.toEqual({ status: 'disabled' });
		expect(create).not.toHaveBeenCalled();

		const enabledService = new ModerationService({ config: config(), client: { moderations: { create } } });
		await expect(enabledService.moderate('   ')).resolves.toEqual({ status: 'allowed' });
	});
});
