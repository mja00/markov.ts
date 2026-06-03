import { createRequire } from 'node:module';

import {
	SQL,
	and,
	cosineDistance,
	desc,
	eq,
	gt,
	isNull,
	or,
	sql,
} from 'drizzle-orm';

import { getDb } from './database.service.js';
import { EmbeddingService } from './embedding.service.js';
import { Logger } from './logger.js';
import { Memory, memories } from '../db/schema.js';

const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');

const DEFAULT_SIMILARITY_THRESHOLD = 0.35;
const DEFAULT_RECALL_LIMIT = 8;
const DEFAULT_DEDUPE_THRESHOLD = 0.9;

const similarityThreshold: number = Config.memory?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
const recallLimit: number = Config.memory?.recallLimit ?? DEFAULT_RECALL_LIMIT;
const dedupeThreshold: number = Config.memory?.dedupeThreshold ?? DEFAULT_DEDUPE_THRESHOLD;

/**
 * Memory scope values
 */
export type MemoryScope = 'USER' | 'SERVER' | 'QUOTE';

/**
 * Input shape for saving a memory
 */
export interface SaveMemoryInput {
	scope: MemoryScope;
	content: string;
	userSnowflake: string | null;
	guildSnowflake: string | null;
	sourceChannelSnowflake?: string | null;
	createdByModel?: boolean;
}

/**
 * Result of a save operation
 */
export interface SaveMemoryResult {
	status: 'saved' | 'duplicate' | 'failed';
	memory: Memory | null;
}

/**
 * Build the privacy-critical scope filter for recall queries.
 *
 * This isolation (a USER memory never crossing guild boundaries) is the single
 * most important correctness property of the memory system. It MUST be unit
 * tested in isolation, which is why it lives as a standalone exported function
 * rather than a private method.
 *
 * @param userSnowflake - The Discord user ID requesting recall
 * @param guildSnowflake - The guild context, or null for DMs
 * @returns A drizzle SQL filter constraining which memories may be recalled
 */
export function buildMemoryScopeFilter(userSnowflake: string, guildSnowflake: string | null): SQL {
	// DM context: only the user's own DM-scoped USER memories (guild is null).
	if (guildSnowflake === null) {
		return and(
			eq(memories.scope, 'USER'),
			eq(memories.userSnowflake, userSnowflake),
			isNull(memories.guildSnowflake),
		) as SQL;
	}

	// Guild context: USER memories are isolated per guild, plus QUOTE and SERVER
	// memories scoped to this guild.
	return or(
		and(
			eq(memories.scope, 'USER'),
			eq(memories.userSnowflake, userSnowflake),
			eq(memories.guildSnowflake, guildSnowflake),
		),
		and(
			eq(memories.scope, 'QUOTE'),
			eq(memories.guildSnowflake, guildSnowflake),
		),
		and(
			eq(memories.scope, 'SERVER'),
			eq(memories.guildSnowflake, guildSnowflake),
		),
	) as SQL;
}

/**
 * Service for managing scoped, semantically-recalled memories.
 */
export class MemoryService {
	private readonly embeddingService = new EmbeddingService();

	/**
	 * Save a memory. Computes the embedding up front; if it cannot be created
	 * the memory is NOT inserted (a null-embedding row would be permanently
	 * unrecallable). Deduplicates against existing memories of the same scope
	 * before inserting.
	 *
	 * Note: the SERVER attribution prefix is applied by the caller, not here.
	 *
	 * @param input - The memory to save
	 * @returns The save result with status and the stored/duplicate row
	 */
	public async saveMemory(input: SaveMemoryInput): Promise<SaveMemoryResult> {
		const db = getDb();

		try {
			const embedding = await this.embeddingService.createEmbedding(input.content);

			if (!embedding) {
				Logger.debug('[MemoryService] Skipping save: embedding could not be created for content');
				return { status: 'failed', memory: null };
			}

			// Dedup: search existing memories with the same scope (and guild, and
			// user when scope is USER) ranked by similarity to the new embedding.
			const similarity = sql<number>`1 - (${cosineDistance(memories.embedding, embedding)})`;

			const dedupeConditions = [
				eq(memories.scope, input.scope),
				input.guildSnowflake === null
					? isNull(memories.guildSnowflake)
					: eq(memories.guildSnowflake, input.guildSnowflake),
			];

			if (input.scope === 'USER') {
				dedupeConditions.push(
					input.userSnowflake === null
						? isNull(memories.userSnowflake)
						: eq(memories.userSnowflake, input.userSnowflake),
				);
			}

			const existing = await db
				.select({
					id: memories.id,
					scope: memories.scope,
					userSnowflake: memories.userSnowflake,
					guildSnowflake: memories.guildSnowflake,
					content: memories.content,
					embedding: memories.embedding,
					sourceChannelSnowflake: memories.sourceChannelSnowflake,
					createdByModel: memories.createdByModel,
					createdAt: memories.createdAt,
					updatedAt: memories.updatedAt,
					similarity,
				})
				.from(memories)
				.where(and(...dedupeConditions))
				.orderBy(desc(similarity))
				.limit(1);

			if (existing.length > 0 && existing[0].similarity >= dedupeThreshold) {
				const { similarity: _similarity, ...duplicate } = existing[0];
				Logger.debug(`[MemoryService] Duplicate memory detected (similarity ${existing[0].similarity})`);
				return { status: 'duplicate', memory: duplicate as Memory };
			}

			const created = await db
				.insert(memories)
				.values({
					scope: input.scope,
					content: input.content,
					userSnowflake: input.userSnowflake,
					guildSnowflake: input.guildSnowflake,
					sourceChannelSnowflake: input.sourceChannelSnowflake ?? null,
					createdByModel: input.createdByModel ?? true,
					embedding,
				})
				.returning();

			Logger.debug(`[MemoryService] Saved ${input.scope} memory ${created[0]?.id}`);
			return { status: 'saved', memory: created[0] };
		} catch (error) {
			Logger.error('[MemoryService] Failed to save memory:', error);
			throw new Error(`Failed to save memory: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Recall memories relevant to a query for the given user/guild context.
	 * Used for auto-recall injection.
	 *
	 * @param queryText - The text to find relevant memories for
	 * @param userSnowflake - The Discord user ID requesting recall
	 * @param guildSnowflake - The guild context, or null for DMs
	 * @param limit - Maximum number of memories to return
	 * @returns Relevant memories ordered by similarity (most similar first)
	 */
	public async recallForContext(
		queryText: string,
		userSnowflake: string,
		guildSnowflake: string | null,
		limit: number = recallLimit,
	): Promise<Memory[]> {
		return this.semanticSearch(queryText, userSnowflake, guildSnowflake, limit);
	}

	/**
	 * Search memories relevant to a query for the given user/guild context.
	 * Backs the recall_memory tool. Identical behaviour to recallForContext.
	 *
	 * @param queryText - The text to find relevant memories for
	 * @param userSnowflake - The Discord user ID requesting recall
	 * @param guildSnowflake - The guild context, or null for DMs
	 * @param limit - Maximum number of memories to return
	 * @returns Relevant memories ordered by similarity (most similar first)
	 */
	public async searchMemories(
		queryText: string,
		userSnowflake: string,
		guildSnowflake: string | null,
		limit: number = recallLimit,
	): Promise<Memory[]> {
		return this.semanticSearch(queryText, userSnowflake, guildSnowflake, limit);
	}

	/**
	 * Shared semantic search backing recall and search. Returns [] (no recency
	 * fallback) when the query embedding cannot be created.
	 */
	private async semanticSearch(
		queryText: string,
		userSnowflake: string,
		guildSnowflake: string | null,
		limit: number,
	): Promise<Memory[]> {
		const db = getDb();

		try {
			const queryEmbedding = await this.embeddingService.createEmbedding(queryText);

			if (!queryEmbedding) {
				Logger.debug('[MemoryService] Recall skipped: query embedding could not be created');
				return [];
			}

			const similarity = sql<number>`1 - (${cosineDistance(memories.embedding, queryEmbedding)})`;

			const results = await db
				.select({
					id: memories.id,
					scope: memories.scope,
					userSnowflake: memories.userSnowflake,
					guildSnowflake: memories.guildSnowflake,
					content: memories.content,
					sourceChannelSnowflake: memories.sourceChannelSnowflake,
					createdByModel: memories.createdByModel,
					createdAt: memories.createdAt,
					updatedAt: memories.updatedAt,
					similarity,
				})
				.from(memories)
				.where(and(buildMemoryScopeFilter(userSnowflake, guildSnowflake), gt(similarity, similarityThreshold)))
				.orderBy(desc(similarity))
				.limit(limit);

			Logger.debug(
				`[MemoryService] Recalled ${results.length} memories (scores: ${results.map(row => row.similarity.toFixed(3)).join(', ')})`,
			);

			return results.map(({ similarity: _similarity, ...memory }) => { return { ...memory, embedding: null }; }) as Memory[];
		} catch (error) {
			Logger.error('[MemoryService] Failed to recall memories:', error);
			throw new Error(`Failed to recall memories: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * List memories belonging to a user within a guild (or DM) context.
	 *
	 * @param userSnowflake - The Discord user ID
	 * @param guildSnowflake - The guild context, or null for DMs
	 * @returns The user's memories ordered most-recent-first
	 */
	public async listForUser(userSnowflake: string, guildSnowflake: string | null): Promise<Memory[]> {
		const db = getDb();

		try {
			return await db
				.select()
				.from(memories)
				.where(
					and(
						eq(memories.userSnowflake, userSnowflake),
						guildSnowflake === null
							? isNull(memories.guildSnowflake)
							: eq(memories.guildSnowflake, guildSnowflake),
					),
				)
				.orderBy(desc(memories.createdAt));
		} catch (error) {
			Logger.error('[MemoryService] Failed to list memories for user:', error);
			throw new Error(`Failed to list memories for user: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * List SERVER-scoped memories for a guild.
	 *
	 * @param guildSnowflake - The guild ID
	 * @returns The guild's SERVER memories ordered most-recent-first
	 */
	public async listForServer(guildSnowflake: string): Promise<Memory[]> {
		const db = getDb();

		try {
			return await db
				.select()
				.from(memories)
				.where(and(eq(memories.scope, 'SERVER'), eq(memories.guildSnowflake, guildSnowflake)))
				.orderBy(desc(memories.createdAt));
		} catch (error) {
			Logger.error('[MemoryService] Failed to list memories for server:', error);
			throw new Error(`Failed to list memories for server: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Delete a memory by ID.
	 *
	 * @param id - The memory UUID
	 * @returns true if a memory was deleted
	 */
	public async forgetById(id: string): Promise<boolean> {
		const db = getDb();

		try {
			const result = await db.delete(memories).where(eq(memories.id, id)).returning();
			return result.length > 0;
		} catch (error) {
			Logger.error('[MemoryService] Failed to forget memory by id:', error);
			throw new Error(`Failed to forget memory: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Delete a memory by ID only if it belongs to the given user (so a user can
	 * only delete their own memories).
	 *
	 * @param id - The memory UUID
	 * @param userSnowflake - The Discord user ID that must own the memory
	 * @returns true if a memory was deleted
	 */
	public async forgetByIdForUser(id: string, userSnowflake: string): Promise<boolean> {
		const db = getDb();

		try {
			const result = await db
				.delete(memories)
				.where(and(eq(memories.id, id), eq(memories.userSnowflake, userSnowflake)))
				.returning();
			return result.length > 0;
		} catch (error) {
			Logger.error('[MemoryService] Failed to forget memory by id for user:', error);
			throw new Error(`Failed to forget memory: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Delete all memories belonging to a user.
	 *
	 * @param userSnowflake - The Discord user ID
	 * @returns The number of memories deleted
	 */
	public async forgetAllForUser(userSnowflake: string): Promise<number> {
		const db = getDb();

		try {
			const result = await db
				.delete(memories)
				.where(eq(memories.userSnowflake, userSnowflake))
				.returning();
			return result.length;
		} catch (error) {
			Logger.error('[MemoryService] Failed to forget all memories for user:', error);
			throw new Error(`Failed to forget memories: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}
}
