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

vi.mock('../../../src/services/automation-settings.js', () => {
	return {
		areAutomationsEnabled: vi.fn(() => true),
	};
});

const { scheduleMock } = vi.hoisted(() => {
	return { scheduleMock: vi.fn() };
});

vi.mock('../../../src/services/scheduled-message.service.js', () => {
	return {
		ScheduledMessageService: class {
			public schedule = scheduleMock;
		},
	};
});

const { selectMock, insertMock, deleteMock, dbMock } = vi.hoisted(() => {
	const selectFn = vi.fn();
	const insertFn = vi.fn();
	const deleteFn = vi.fn();
	return {
		selectMock: selectFn,
		insertMock: insertFn,
		deleteMock: deleteFn,
		dbMock: {
			select: selectFn,
			insert: insertFn,
			delete: deleteFn,
		},
	};
});

vi.mock('../../../src/services/database.service.js', () => {
	return {
		getDb: vi.fn(() => dbMock),
	};
});

import { ProactivePreferencesService } from '../../../src/services/proactive-preferences.service.js';

// db.select().from().where() -> rows
function mockSubscribers(rows: unknown[]): void {
	const where = vi.fn().mockResolvedValue(rows);
	const from = vi.fn(() => { return { where }; });
	selectMock.mockReturnValue({ from });
}

// db.insert().values().onConflictDoNothing().returning() -> one row (claim won)
function mockClaimAlwaysWins(): void {
	const returning = vi.fn().mockResolvedValue([{ id: 'claim' }]);
	const onConflictDoNothing = vi.fn(() => { return { returning }; });
	const values = vi.fn(() => { return { onConflictDoNothing }; });
	insertMock.mockReturnValue({ values });
}

function subscriber(userSnowflake: string): unknown {
	return {
		preferenceKey: `GUILD_A:${userSnowflake}`,
		userSnowflake,
		destinationChannelSnowflake: `chan-${userSnowflake}`,
	};
}

describe('ProactivePreferencesService.enqueueRareCatchAlerts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const where = vi.fn().mockResolvedValue(undefined);
		deleteMock.mockReturnValue({ where });
	});

	it('continues to remaining subscribers when one schedule fails', async () => {
		mockSubscribers([subscriber('U1'), subscriber('U2'), subscriber('U3')]);
		mockClaimAlwaysWins();
		scheduleMock
			.mockRejectedValueOnce(new Error('channel at pending cap'))
			.mockResolvedValue({ id: 'sm' });

		const service = new ProactivePreferencesService();
		await service.enqueueRareCatchAlerts({
			guildSnowflake: 'GUILD_A',
			catcherSnowflake: 'CATCHER',
			catchableName: 'Golden Koi',
			rarityName: 'LEGENDARY',
			eventKey: 'catch-1',
		});

		// The one-shot eventKey never re-fires, so an aborted loop would
		// permanently drop U2/U3's alerts.
		expect(scheduleMock).toHaveBeenCalledTimes(3);
		// The failed subscriber's claim was released so nothing is stuck claimed.
		expect(deleteMock).toHaveBeenCalledTimes(1);
	});
});
