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

const { insertMock, selectMock, updateMock, dbMock } = vi.hoisted(() => {
	const insertFn = vi.fn();
	const selectFn = vi.fn();
	const updateFn = vi.fn();
	return {
		insertMock: insertFn,
		selectMock: selectFn,
		updateMock: updateFn,
		dbMock: {
			insert: insertFn,
			select: selectFn,
			update: updateFn,
			delete: vi.fn(),
		},
	};
});

vi.mock('../../../src/services/database.service.js', () => {
	return {
		getDb: vi.fn(() => dbMock),
	};
});

import { ScheduledMessageService } from '../../../src/services/scheduled-message.service.js';

// db.select().from().where().orderBy() -> rows
function mockListPending(rows: unknown[]): void {
	const orderBy = vi.fn().mockResolvedValue(rows);
	const where = vi.fn(() => { return { orderBy }; });
	const from = vi.fn(() => { return { where }; });
	selectMock.mockReturnValue({ from });
}

// db.insert().values().returning() -> rows
function mockInsert(rows: unknown[]): ReturnType<typeof vi.fn> {
	const returning = vi.fn().mockResolvedValue(rows);
	const values = vi.fn(() => { return { returning }; });
	insertMock.mockReturnValue({ values });
	return values;
}

// db.update().set().where().returning() -> rows
function mockUpdate(rows: unknown[]): { set: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn>; } {
	const returning = vi.fn().mockResolvedValue(rows);
	const where = vi.fn(() => { return { returning }; });
	const set = vi.fn(() => { return { where }; });
	updateMock.mockReturnValue({ set });
	return { set, where };
}

const CHANNEL = 'CHANNEL_A';

describe('ScheduledMessageService', () => {
	beforeEach(() => {
		insertMock.mockReset();
		selectMock.mockReset();
		updateMock.mockReset();
	});

	describe('schedule', () => {
		it('rejects empty content before touching the database', async () => {
			const service = new ScheduledMessageService();
			await expect(service.schedule({
				channelSnowflake: CHANNEL,
				guildSnowflake: 'GUILD_A',
				createdBySnowflake: 'USER123',
				content: '   ',
				scheduledAt: new Date(Date.now() + (60 * 60 * 1000)),
			})).rejects.toThrow(/empty/i);
			expect(insertMock).not.toHaveBeenCalled();
		});

		it('rejects a time in the past / too soon', async () => {
			const service = new ScheduledMessageService();
			await expect(service.schedule({
				channelSnowflake: CHANNEL,
				guildSnowflake: 'GUILD_A',
				createdBySnowflake: 'USER123',
				content: 'hello later',
				scheduledAt: new Date(Date.now() - 1000),
			})).rejects.toThrow(/future/i);
			expect(insertMock).not.toHaveBeenCalled();
		});

		it('rejects a time beyond the max horizon', async () => {
			const service = new ScheduledMessageService();
			await expect(service.schedule({
				channelSnowflake: CHANNEL,
				guildSnowflake: 'GUILD_A',
				createdBySnowflake: 'USER123',
				content: 'hello much later',
				scheduledAt: new Date(Date.now() + (31 * 24 * 60 * 60 * 1000)),
			})).rejects.toThrow(/at most/i);
			expect(insertMock).not.toHaveBeenCalled();
		});

		it('rejects when the channel is already at the pending cap', async () => {
			mockListPending(Array.from({ length: 20 }, (_unused, index) => { return { id: `m${index}` }; }));

			const service = new ScheduledMessageService();
			await expect(service.schedule({
				channelSnowflake: CHANNEL,
				guildSnowflake: 'GUILD_A',
				createdBySnowflake: 'USER123',
				content: 'one too many',
				scheduledAt: new Date(Date.now() + (60 * 60 * 1000)),
			})).rejects.toThrow(/maximum/i);
			expect(insertMock).not.toHaveBeenCalled();
		});

		it('inserts a trimmed PENDING row when valid', async () => {
			mockListPending([]);
			const values = mockInsert([{ id: 'new-id', scheduledAt: new Date(Date.now() + (60 * 60 * 1000)) }]);

			const service = new ScheduledMessageService();
			const created = await service.schedule({
				channelSnowflake: CHANNEL,
				guildSnowflake: 'GUILD_A',
				createdBySnowflake: 'USER123',
				content: '  hello later  ',
				scheduledAt: new Date(Date.now() + (60 * 60 * 1000)),
			});

			expect(created.id).toBe('new-id');
			expect(values).toHaveBeenCalledTimes(1);
			expect(values.mock.calls[0][0]).toMatchObject({
				channelSnowflake: CHANNEL,
				guildSnowflake: 'GUILD_A',
				createdBySnowflake: 'USER123',
				content: 'hello later', // trimmed
			});
		});
	});

	describe('cancel', () => {
		it('returns true when a pending row is cancelled', async () => {
			const { set } = mockUpdate([{ id: 'sm1' }]);
			const service = new ScheduledMessageService();
			const result = await service.cancel('sm1', CHANNEL);
			expect(result).toBe(true);
			expect(set.mock.calls[0][0]).toMatchObject({ status: 'CANCELLED' });
		});

		it('returns false when nothing matched (wrong channel or already gone)', async () => {
			mockUpdate([]);
			const service = new ScheduledMessageService();
			expect(await service.cancel('sm1', CHANNEL)).toBe(false);
		});
	});

	describe('claimDue (exactly-once)', () => {
		it('returns true and flips status to SENT when this caller wins the claim', async () => {
			const { set } = mockUpdate([{ id: 'sm1' }]);
			const service = new ScheduledMessageService();
			expect(await service.claimDue('sm1')).toBe(true);
			expect(set.mock.calls[0][0]).toMatchObject({ status: 'SENT' });
		});

		it('returns false when another caller already claimed it', async () => {
			mockUpdate([]);
			const service = new ScheduledMessageService();
			expect(await service.claimDue('sm1')).toBe(false);
		});
	});
});
