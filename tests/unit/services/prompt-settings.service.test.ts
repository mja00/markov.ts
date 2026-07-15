import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

// Mock the logger to prevent config.json loading and silence output.
vi.mock('../../../src/services/logger.js', () => {
	return {
		Logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		},
	};
});

// Chainable database mock. Each query builder is a thin stub whose terminal
// method resolves to a configurable result.
const { selectMock, insertMock, updateMock, dbMock } = vi.hoisted(() => {
	const selectFn = vi.fn();
	const insertFn = vi.fn();
	const updateFn = vi.fn();
	return {
		selectMock: selectFn,
		insertMock: insertFn,
		updateMock: updateFn,
		dbMock: { select: selectFn, insert: insertFn, update: updateFn },
	};
});

vi.mock('../../../src/services/database.service.js', () => {
	return {
		getDb: vi.fn(() => dbMock),
	};
});

import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT } from '../../../src/prompts/default-prompt.js';
import { PromptSettingsService } from '../../../src/services/prompt-settings.service.js';

// Builders matching the call chains in the service.
function makeSelect(rows: unknown[]): unknown {
	return { from: () => { return { where: () => { return { limit: () => Promise.resolve(rows) }; } }; } };
}
function makeInsert(): unknown {
	return { values: () => { return { onConflictDoNothing: () => Promise.resolve(undefined) }; } };
}
function makeUpdate(rows: unknown[], capture?: (set: Record<string, unknown>) => void): unknown {
	return {
		set: (payload: Record<string, unknown>) => {
			capture?.(payload);
			return { where: () => { return { returning: () => Promise.resolve(rows) }; } };
		},
	};
}

const existingRow = {
	id: 1,
	systemPrompt: 'stored prompt',
	model: 'stored-model',
	reasoningEffort: 'low',
	verbosity: 'high',
	reasoningSummary: 'concise',
	updatedAt: new Date(),
};

function freshService(): PromptSettingsService {
	// Reset the singleton so each test gets a clean cache.
	(PromptSettingsService as unknown as { instance: PromptSettingsService | null; }).instance = null;
	return PromptSettingsService.getInstance();
}

describe('PromptSettingsService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('seeds the singleton row on first get when absent, then returns it', async () => {
		// First select: empty (triggers seed). Second select: the seeded row.
		selectMock
			.mockReturnValueOnce(makeSelect([]))
			.mockReturnValueOnce(makeSelect([existingRow]));
		insertMock.mockReturnValue(makeInsert());

		const service = freshService();
		const settings = await service.get();

		expect(insertMock).toHaveBeenCalledTimes(1);
		expect(settings).toEqual(existingRow);
	});

	it('does not double-insert: a present row is returned without seeding', async () => {
		selectMock.mockReturnValueOnce(makeSelect([existingRow]));

		const service = freshService();
		const settings = await service.get();

		expect(insertMock).not.toHaveBeenCalled();
		expect(settings).toEqual(existingRow);
	});

	it('serves a cached value within the TTL without re-reading the DB', async () => {
		selectMock.mockReturnValueOnce(makeSelect([existingRow]));

		const service = freshService();
		await service.get();
		expect(selectMock).toHaveBeenCalledTimes(1);

		await service.get();
		// Still 1 — the second call was served from cache.
		expect(selectMock).toHaveBeenCalledTimes(1);
	});

	it('falls back to in-code defaults and does NOT throw when the DB errors', async () => {
		selectMock.mockImplementation(() => {
			throw new Error('database down');
		});

		const service = freshService();
		const settings = await service.get();

		expect(settings.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(settings.model).toBe(DEFAULT_MODEL);
		// The fallback is not cached, so a later call retries the DB.
		await service.get();
		expect(selectMock).toHaveBeenCalledTimes(2);
	});

	it('update() writes WHERE id=1 and refreshes the cache', async () => {
		selectMock.mockReturnValueOnce(makeSelect([existingRow]));
		const updatedRow = { ...existingRow, model: 'new-model' };
		updateMock.mockReturnValue(makeUpdate([updatedRow]));

		const service = freshService();
		const result = await service.update({ model: 'new-model' });

		expect(result).toEqual(updatedRow);

		// Next get() is served from the refreshed cache — no further select.
		selectMock.mockClear();
		const after = await service.get();
		expect(after).toEqual(updatedRow);
		expect(selectMock).not.toHaveBeenCalled();
	});

	it('rejects an empty system prompt', async () => {
		const service = freshService();
		await expect(service.update({ systemPrompt: '   ' })).rejects.toThrow(/empty/i);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('rejects an out-of-set reasoning effort', async () => {
		const service = freshService();
		await expect(service.update({ reasoningEffort: 'turbo' })).rejects.toThrow(/reasoning effort/i);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('reset() writes the in-code defaults', async () => {
		selectMock.mockReturnValueOnce(makeSelect([existingRow]));
		let captured: Record<string, unknown> = {};
		updateMock.mockReturnValue(makeUpdate([existingRow], (set) => {
			captured = set;
		}));

		const service = freshService();
		await service.reset();

		expect(captured.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(captured.model).toBe(DEFAULT_MODEL);
	});
});
