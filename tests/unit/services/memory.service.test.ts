import { PgDialect } from 'drizzle-orm/pg-core';
import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

// Mock the logger to prevent config.json loading
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

// Mock the embedding service so we control the embedding result.
const { createEmbeddingMock, insertMock, selectMock, deleteMock, dbMock } = vi.hoisted(() => {
	const insertFn = vi.fn();
	const selectFn = vi.fn();
	const deleteFn = vi.fn();
	return {
		createEmbeddingMock: vi.fn(),
		insertMock: insertFn,
		selectMock: selectFn,
		deleteMock: deleteFn,
		dbMock: {
			insert: insertFn,
			select: selectFn,
			delete: deleteFn,
			update: vi.fn(),
		},
	};
});

vi.mock('../../../src/services/embedding.service.js', () => {
	return {
		EmbeddingService: vi.fn(function EmbeddingService() {
			return { createEmbedding: createEmbeddingMock };
		}),
	};
});

// Mock the database service with a chainable builder that records calls.
vi.mock('../../../src/services/database.service.js', () => {
	return {
		getDb: vi.fn(() => dbMock),
	};
});

import { MemoryService, buildMemoryScopeFilter } from '../../../src/services/memory.service.js';

const dialect = new PgDialect();

describe('buildMemoryScopeFilter (privacy-critical scope isolation)', () => {
	it('constrains USER memories by guild in guild context and references all three scopes', () => {
		const { sql, params } = dialect.sqlToQuery(buildMemoryScopeFilter('USER123', 'GUILD_A'));
		const lower = sql.toLowerCase();

		// All three scopes must be represented in a guild context.
		expect(params).toContain('USER');
		expect(params).toContain('QUOTE');
		expect(params).toContain('SERVER');

		// The user's snowflake and the guild must both be parameters: a USER
		// memory query is constrained by guild (cross-guild-leak regression guard).
		expect(params).toContain('USER123');
		expect(params).toContain('GUILD_A');

		// The guild column must be referenced (the USER branch ANDs guild_snowflake).
		expect(lower).toContain('guild_snowflake');
		expect(lower).toContain('user_snowflake');

		// GUILD_A must appear at least three times: once per scope branch
		// (USER, QUOTE, SERVER), proving the USER branch is guild-scoped.
		const guildOccurrences = params.filter(param => param === 'GUILD_A').length;
		expect(guildOccurrences).toBeGreaterThanOrEqual(3);
	});

	it('returns ONLY the USER scope with an is-null guild check in DM context', () => {
		const { sql, params } = dialect.sqlToQuery(buildMemoryScopeFilter('USER123', null));
		const lower = sql.toLowerCase();

		// Only the USER scope should appear; no SERVER/QUOTE branches.
		expect(params).toContain('USER');
		expect(params).not.toContain('SERVER');
		expect(params).not.toContain('QUOTE');

		// Guild must be checked with IS NULL, and no concrete guild value present.
		expect(lower).toContain('is null');
		expect(params).not.toContain('GUILD_A');

		// The user is still constrained.
		expect(params).toContain('USER123');
	});

	it('does not let a guild value satisfy the DM filter', () => {
		const dm = dialect.sqlToQuery(buildMemoryScopeFilter('USER123', null));
		// A DM filter must not embed any guild value, so guild A can never match.
		expect(dm.params).not.toContain('GUILD_A');
		expect(dm.params).not.toContain('GUILD_B');
	});
});

describe('MemoryService', () => {
	beforeEach(() => {
		createEmbeddingMock.mockReset();
		insertMock.mockReset();
		selectMock.mockReset();
		deleteMock.mockReset();
	});

	describe('saveMemory', () => {
		it('returns failed and does not insert when embedding is null', async () => {
			createEmbeddingMock.mockResolvedValue(null);

			const service = new MemoryService();
			const result = await service.saveMemory({
				scope: 'USER',
				content: 'remember this',
				userSnowflake: 'USER123',
				guildSnowflake: 'GUILD_A',
			});

			expect(result).toEqual({ status: 'failed', memory: null });
			expect(insertMock).not.toHaveBeenCalled();
			expect(selectMock).not.toHaveBeenCalled();
		});

		it('returns duplicate and does not insert when a similar memory exists', async () => {
			createEmbeddingMock.mockResolvedValue(Array.from({ length: 1536 }, () => 0.1));

			const existingRow = {
				id: 'existing-id',
				scope: 'USER',
				userSnowflake: 'USER123',
				guildSnowflake: 'GUILD_A',
				content: 'remember this',
				embedding: null,
				sourceChannelSnowflake: null,
				createdByModel: true,
				createdAt: new Date(),
				updatedAt: new Date(),
				similarity: 0.95,
			};

			// db.select().from().where().orderBy().limit() -> [existingRow]
			const limit = vi.fn().mockResolvedValue([existingRow]);
			const orderBy = vi.fn(() => { return { limit }; });
			const where = vi.fn(() => { return { orderBy }; });
			const from = vi.fn(() => { return { where }; });
			selectMock.mockReturnValue({ from });

			const service = new MemoryService();
			const result = await service.saveMemory({
				scope: 'USER',
				content: 'remember this',
				userSnowflake: 'USER123',
				guildSnowflake: 'GUILD_A',
			});

			expect(result.status).toBe('duplicate');
			expect(result.memory?.id).toBe('existing-id');
			expect(insertMock).not.toHaveBeenCalled();
		});

		it('inserts and returns saved when no duplicate exists', async () => {
			createEmbeddingMock.mockResolvedValue(Array.from({ length: 1536 }, () => 0.1));

			const limit = vi.fn().mockResolvedValue([]); // no duplicate
			const orderBy = vi.fn(() => { return { limit }; });
			const where = vi.fn(() => { return { orderBy }; });
			const from = vi.fn(() => { return { where }; });
			selectMock.mockReturnValue({ from });

			const createdRow = {
				id: 'new-id',
				scope: 'USER',
				userSnowflake: 'USER123',
				guildSnowflake: 'GUILD_A',
				content: 'remember this',
				embedding: null,
				sourceChannelSnowflake: null,
				createdByModel: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			const returning = vi.fn().mockResolvedValue([createdRow]);
			const values = vi.fn(() => { return { returning }; });
			insertMock.mockReturnValue({ values });

			const service = new MemoryService();
			const result = await service.saveMemory({
				scope: 'USER',
				content: 'remember this',
				userSnowflake: 'USER123',
				guildSnowflake: 'GUILD_A',
			});

			expect(result.status).toBe('saved');
			expect(result.memory?.id).toBe('new-id');
			expect(insertMock).toHaveBeenCalledTimes(1);
		});

		it('does not stamp SERVER memories with the caller snowflake (admin-gate isolation)', async () => {
			createEmbeddingMock.mockResolvedValue(Array.from({ length: 1536 }, () => 0.1));

			const limit = vi.fn().mockResolvedValue([]); // no duplicate
			const orderBy = vi.fn(() => { return { limit }; });
			const where = vi.fn(() => { return { orderBy }; });
			const from = vi.fn(() => { return { where }; });
			selectMock.mockReturnValue({ from });

			const returning = vi.fn().mockResolvedValue([{ id: 'server-id' }]);
			const values = vi.fn(() => { return { returning }; });
			insertMock.mockReturnValue({ values });

			const service = new MemoryService();
			await service.saveMemory({
				scope: 'SERVER',
				content: 'USER123 claimed: the server is about fishing',
				userSnowflake: 'USER123',
				guildSnowflake: 'GUILD_A',
			});

			// SERVER memories must be stored with a null userSnowflake so user-scoped
			// delete APIs cannot remove them, bypassing the Manage Server admin gate.
			expect(values).toHaveBeenCalledTimes(1);
			expect(values.mock.calls[0][0]).toMatchObject({
				scope: 'SERVER',
				userSnowflake: null,
				guildSnowflake: 'GUILD_A',
			});
		});
	});

	describe('recallForContext', () => {
		it('returns [] and does not query the DB when query embedding is null', async () => {
			createEmbeddingMock.mockResolvedValue(null);

			const service = new MemoryService();
			const result = await service.recallForContext('what do you know', 'USER123', 'GUILD_A');

			expect(result).toEqual([]);
			expect(selectMock).not.toHaveBeenCalled();
		});
	});

	describe('searchMemories', () => {
		it('returns [] and does not query the DB when query embedding is null', async () => {
			createEmbeddingMock.mockResolvedValue(null);

			const service = new MemoryService();
			const result = await service.searchMemories('what do you know', 'USER123', null);

			expect(result).toEqual([]);
			expect(selectMock).not.toHaveBeenCalled();
		});
	});

	describe('forgetByIdForGuild', () => {
		it('returns true when a row matching both id and guildSnowflake is deleted', async () => {
			const returning = vi.fn().mockResolvedValue([{ id: 'mem-uuid-1' }]);
			const where = vi.fn(() => { return { returning }; });
			deleteMock.mockReturnValue({ where });

			const service = new MemoryService();
			const result = await service.forgetByIdForGuild('mem-uuid-1', 'GUILD_A');

			expect(result).toBe(true);
			expect(deleteMock).toHaveBeenCalledTimes(1);
			expect(where).toHaveBeenCalledTimes(1);
			expect(returning).toHaveBeenCalledTimes(1);
		});

		it('returns false when no row matches (wrong guild or non-existent id)', async () => {
			const returning = vi.fn().mockResolvedValue([]);
			const where = vi.fn(() => { return { returning }; });
			deleteMock.mockReturnValue({ where });

			const service = new MemoryService();
			const result = await service.forgetByIdForGuild('mem-uuid-1', 'GUILD_B');

			expect(result).toBe(false);
		});

		it('constrains the delete by both id and guildSnowflake', async () => {
			const returning = vi.fn().mockResolvedValue([]);
			const where = vi.fn(() => { return { returning }; });
			deleteMock.mockReturnValue({ where });

			const service = new MemoryService();
			await service.forgetByIdForGuild('mem-uuid-1', 'GUILD_A');

			// The where clause must encode both the memory id and the guild — verify
			// by rendering the SQL condition the same way the scope-filter tests do.
			const whereArg = where.mock.calls[0][0];
			const { sql, params } = dialect.sqlToQuery(whereArg);
			const lower = sql.toLowerCase();

			expect(params).toContain('mem-uuid-1');
			expect(params).toContain('GUILD_A');
			expect(lower).toContain('guild_snowflake');
		});

		it('throws when the db operation rejects', async () => {
			const where = vi.fn(() => { return { returning: vi.fn().mockRejectedValue(new Error('db error')) }; });
			deleteMock.mockReturnValue({ where });

			const service = new MemoryService();
			await expect(service.forgetByIdForGuild('mem-uuid-1', 'GUILD_A')).rejects.toThrow('Failed to forget memory');
		});
	});

	describe('forgetAllForGuild', () => {
		it('returns the count of deleted rows', async () => {
			const returning = vi.fn().mockResolvedValue([{ id: 'mem-1' }, { id: 'mem-2' }]);
			const where = vi.fn(() => { return { returning }; });
			deleteMock.mockReturnValue({ where });

			const service = new MemoryService();
			const count = await service.forgetAllForGuild('GUILD_A');

			expect(count).toBe(2);
			expect(deleteMock).toHaveBeenCalledTimes(1);
		});

		it('constrains the delete to SERVER scope and the guild (never users\' private memories)', async () => {
			const returning = vi.fn().mockResolvedValue([]);
			const where = vi.fn(() => { return { returning }; });
			deleteMock.mockReturnValue({ where });

			const service = new MemoryService();
			await service.forgetAllForGuild('GUILD_A');

			// The where clause must encode both the SERVER scope and the guild, so an
			// admin "forget all" can never wipe users' private USER memories.
			const whereArg = where.mock.calls[0][0];
			const { sql, params } = dialect.sqlToQuery(whereArg);
			const lower = sql.toLowerCase();

			expect(params).toContain('SERVER');
			expect(params).toContain('GUILD_A');
			expect(params).not.toContain('USER');
			expect(params).not.toContain('QUOTE');
			expect(lower).toContain('guild_snowflake');
		});

		it('throws when the db operation rejects', async () => {
			const where = vi.fn(() => { return { returning: vi.fn().mockRejectedValue(new Error('db error')) }; });
			deleteMock.mockReturnValue({ where });

			const service = new MemoryService();
			await expect(service.forgetAllForGuild('GUILD_A')).rejects.toThrow('Failed to forget memories');
		});
	});
});
