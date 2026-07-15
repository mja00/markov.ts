import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

// Mock the logger to prevent config.json loading.
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

const { selectMock, deleteMock, transactionMock, txInsertMock, txDeleteMock, dbMock } = vi.hoisted(() => {
	const selectFn = vi.fn();
	const deleteFn = vi.fn();
	const txInsertFn = vi.fn();
	const txDeleteFn = vi.fn();
	const transactionFn = vi.fn(async (callback: (tx: unknown) => Promise<void>) => callback({ insert: txInsertFn, delete: txDeleteFn }));
	return {
		selectMock: selectFn,
		deleteMock: deleteFn,
		transactionMock: transactionFn,
		txInsertMock: txInsertFn,
		txDeleteMock: txDeleteFn,
		dbMock: {
			select: selectFn,
			delete: deleteFn,
			insert: vi.fn(),
			transaction: transactionFn,
		},
	};
});

vi.mock('../../../src/services/database.service.js', () => {
	return {
		getDb: vi.fn(() => dbMock),
	};
});

import { ChannelContextService } from '../../../src/services/channel-context.service.js';
import { Logger } from '../../../src/services/logger.js';

const GUILD = 'GUILD_A';
const CHANNEL = 'CHANNEL_A';

// db.select().from().where().orderBy().limit() -> rows
function mockSelect(rows: unknown[]): void {
	const limit = vi.fn().mockResolvedValue(rows);
	const orderBy = vi.fn(() => { return { limit }; });
	const where = vi.fn(() => { return { orderBy }; });
	const from = vi.fn(() => { return { where }; });
	selectMock.mockReturnValue({ from });
}

// tx.insert().values().onConflictDoNothing().returning() -> rows
function mockTxInsert(rows: unknown[]): ReturnType<typeof vi.fn> {
	const returning = vi.fn().mockResolvedValue(rows);
	const onConflictDoNothing = vi.fn(() => { return { returning }; });
	const values = vi.fn(() => { return { onConflictDoNothing }; });
	txInsertMock.mockReturnValue({ values });
	return values;
}

// tx.delete().where() -> resolves
function mockTxDelete(): ReturnType<typeof vi.fn> {
	const where = vi.fn().mockResolvedValue(undefined);
	txDeleteMock.mockReturnValue({ where });
	return where;
}

function makeRows(count: number, contentLength = 10): Array<{ messageSnowflake: string; authorName: string; content: string; }> {
	return Array.from({ length: count }, (_unused, index) => {
		return {
			messageSnowflake: `msg${index}`,
			authorName: `user${index}`,
			content: 'x'.repeat(contentLength),
		};
	});
}

describe('ChannelContextService summarization', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does nothing when the channel is under the summary threshold', async () => {
		mockSelect(makeRows(2));
		const summarizer = vi.fn();
		const service = new ChannelContextService({ summaryThreshold: 3, summarizer });

		await service.summarize(GUILD, CHANNEL);

		expect(summarizer).not.toHaveBeenCalled();
		expect(transactionMock).not.toHaveBeenCalled();
	});

	it('does nothing when no summarizer is configured (never stores raw transcripts)', async () => {
		mockSelect(makeRows(3));
		const service = new ChannelContextService({ summaryThreshold: 3 });

		await service.summarize(GUILD, CHANNEL);

		expect(transactionMock).not.toHaveBeenCalled();
	});

	it('stores the AI summary (not the raw transcript) with an expiry', async () => {
		mockSelect(makeRows(3));
		const values = mockTxInsert([{ id: 'summary-1' }]);
		const txDeleteWhere = mockTxDelete();
		const summarizer = vi.fn().mockResolvedValue('An abstractive digest.');
		const ttlMs = 7 * 24 * 60 * 60 * 1000;
		const service = new ChannelContextService({ summaryThreshold: 3, summaryTtlMs: ttlMs, summarizer });

		const before = Date.now();
		await service.summarize(GUILD, CHANNEL);

		expect(summarizer).toHaveBeenCalledTimes(1);
		// The raw transcript is model input only; the routing key is the channel.
		expect(summarizer.mock.calls[0][0]).toContain('user0:');
		expect(summarizer.mock.calls[0][1]).toBe(CHANNEL);

		expect(values).toHaveBeenCalledTimes(1);
		const inserted = values.mock.calls[0][0];
		expect(inserted.summary).toBe('An abstractive digest.');
		expect(inserted.summary).not.toContain('user0:');
		expect(inserted.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlMs);
		expect(inserted.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + ttlMs);
		expect(txDeleteWhere).toHaveBeenCalledTimes(1);
	});

	it('caps the transcript passed to the summarizer at 8000 characters', async () => {
		mockSelect(makeRows(3, 5000));
		mockTxInsert([{ id: 'summary-1' }]);
		mockTxDelete();
		const summarizer = vi.fn().mockResolvedValue('Digest.');
		const service = new ChannelContextService({ summaryThreshold: 3, summarizer });

		await service.summarize(GUILD, CHANNEL);

		expect(summarizer.mock.calls[0][0].length).toBeLessThanOrEqual(8000);
	});

	it('skips storage when the summarizer returns null', async () => {
		mockSelect(makeRows(3));
		const summarizer = vi.fn().mockResolvedValue(null);
		const service = new ChannelContextService({ summaryThreshold: 3, summarizer });

		await service.summarize(GUILD, CHANNEL);

		expect(transactionMock).not.toHaveBeenCalled();
	});

	it('swallows summarizer failures and leaves messages to expire naturally', async () => {
		mockSelect(makeRows(3));
		const summarizer = vi.fn().mockRejectedValue(new Error('model unavailable'));
		const service = new ChannelContextService({ summaryThreshold: 3, summarizer });

		await expect(service.summarize(GUILD, CHANNEL)).resolves.toBeUndefined();

		expect(Logger.warn).toHaveBeenCalled();
		expect(transactionMock).not.toHaveBeenCalled();
	});

	it('does not delete source messages when another instance already summarized', async () => {
		mockSelect(makeRows(3));
		mockTxInsert([]); // onConflictDoNothing hit the unique through-message index
		const txDeleteWhere = mockTxDelete();
		const summarizer = vi.fn().mockResolvedValue('Digest.');
		const service = new ChannelContextService({ summaryThreshold: 3, summarizer });

		await service.summarize(GUILD, CHANNEL);

		expect(txDeleteWhere).not.toHaveBeenCalled();
	});

	it('deleteExpired sweeps both retained messages and summaries', async () => {
		const where = vi.fn().mockResolvedValue(undefined);
		deleteMock.mockReturnValue({ where });
		const service = new ChannelContextService();

		await service.deleteExpired();

		expect(deleteMock).toHaveBeenCalledTimes(2);
		expect(where).toHaveBeenCalledTimes(2);
	});
});
