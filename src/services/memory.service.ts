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
// config.json is gitignored and absent in CI/test environments; fall back to
// defaults so importing this module never throws. Threshold reads below use ?? fallbacks.
let Config: { memory?: { similarityThreshold?: number; recallLimit?: number; dedupeThreshold?: number; }; } = {};
try {
	Config = require('../../config/config.json');
} catch {
	Logger.warn('[MemoryService] config.json not found; using default memory thresholds.');
}

// Metadata columns for list queries. Deliberately excludes the 1536-dimension
// `embedding` vector, which list/UI callers never need and which would bloat
// DB I/O and payload size. Callers set `embedding: null` on the returned rows.
const MEMORY_LIST_COLUMNS = {
	id: memories.id,
	scope: memories.scope,
	userSnowflake: memories.userSnowflake,
	guildSnowflake: memories.guildSnowflake,
	content: memories.content,
	kind: memories.kind,
	confidence: memories.confidence,
	importance: memories.importance,
	expiresAt: memories.expiresAt,
	lastConfirmedAt: memories.lastConfirmedAt,
	sourceMessageSnowflake: memories.sourceMessageSnowflake,
	supersededBy: memories.supersededBy,
	sourceChannelSnowflake: memories.sourceChannelSnowflake,
	createdByModel: memories.createdByModel,
	createdAt: memories.createdAt,
	updatedAt: memories.updatedAt,
};

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
	kind?: 'PREFERENCE' | 'FACT' | 'QUOTE' | 'REMINDER';
	confidence?: number;
	importance?: number;
	expiresAt?: Date | null;
	sourceMessageSnowflake?: string | null;
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
					kind: memories.kind,
					confidence: memories.confidence,
					importance: memories.importance,
					expiresAt: memories.expiresAt,
					lastConfirmedAt: memories.lastConfirmedAt,
					sourceMessageSnowflake: memories.sourceMessageSnowflake,
					supersededBy: memories.supersededBy,
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
					// Only USER memories are owned by a user. Stamping SERVER/QUOTE
					// memories with the caller's snowflake would let user-scoped delete
					// APIs (forgetByIdForUser / forgetAllForUser) remove them, bypassing
					// the admin gate that protects server memories.
					userSnowflake: input.scope === 'USER' ? input.userSnowflake : null,
					guildSnowflake: input.guildSnowflake,
					sourceChannelSnowflake: input.sourceChannelSnowflake ?? null,
					createdByModel: input.createdByModel ?? true,
					kind: input.kind ?? (input.scope === 'QUOTE' ? 'QUOTE' : 'FACT'),
					confidence: String(Math.min(1, Math.max(0, input.confidence ?? 0.75))),
					importance: Math.min(100, Math.max(0, input.importance ?? 50)),
					expiresAt: input.expiresAt ?? null,
					lastConfirmedAt: input.createdByModel === false ? new Date() : null,
					sourceMessageSnowflake: input.sourceMessageSnowflake ?? null,
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
			const exactBoost = sql<number>`case when lower(${memories.content}) like ${`%${queryText.toLowerCase()}%`} then 0.25 else 0 end`;
			const rank = sql<number>`${similarity} + (${memories.importance} / 500.0) + ${exactBoost}`;

			const results = await db
				.select({
					id: memories.id,
					scope: memories.scope,
					userSnowflake: memories.userSnowflake,
					guildSnowflake: memories.guildSnowflake,
					content: memories.content,
					kind: memories.kind,
					confidence: memories.confidence,
					importance: memories.importance,
					expiresAt: memories.expiresAt,
					lastConfirmedAt: memories.lastConfirmedAt,
					sourceMessageSnowflake: memories.sourceMessageSnowflake,
					supersededBy: memories.supersededBy,
					sourceChannelSnowflake: memories.sourceChannelSnowflake,
					createdByModel: memories.createdByModel,
					createdAt: memories.createdAt,
					updatedAt: memories.updatedAt,
					similarity,
				})
				.from(memories)
				.where(and(
					buildMemoryScopeFilter(userSnowflake, guildSnowflake),
					gt(similarity, similarityThreshold),
					isNull(memories.supersededBy),
					or(isNull(memories.expiresAt), gt(memories.expiresAt, new Date())),
				))
				.orderBy(desc(rank), desc(memories.updatedAt))
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

	public async editForUser(id: string, userSnowflake: string, guildSnowflake: string | null, content: string): Promise<boolean> {
		const embedding = await this.embeddingService.createEmbedding(content);
		if (!embedding) { return false; }
		const updated = await getDb().update(memories).set({
			content, embedding, lastConfirmedAt: new Date(), confidence: '1.000', updatedAt: new Date(),
		})
			.where(and(
				eq(memories.id, id),
				eq(memories.userSnowflake, userSnowflake),
				guildSnowflake === null ? isNull(memories.guildSnowflake) : eq(memories.guildSnowflake, guildSnowflake),
			))
			.returning();
		return updated.length > 0;
	}

	public async correctForUser(id: string, userSnowflake: string, guildSnowflake: string | null, content: string): Promise<boolean> {
		const existing = await getDb().select().from(memories)
			.where(and(
				eq(memories.id, id),
				eq(memories.userSnowflake, userSnowflake),
				guildSnowflake === null ? isNull(memories.guildSnowflake) : eq(memories.guildSnowflake, guildSnowflake),
			))
			.limit(1);
		if (!existing[0]) { return false; }
		const embedding = await this.embeddingService.createEmbedding(content);
		if (!embedding) { return false; }
		const created = await getDb().insert(memories).values({
			scope: existing[0].scope,
			content,
			userSnowflake,
			guildSnowflake: existing[0].guildSnowflake,
			kind: existing[0].kind,
			confidence: '1.000',
			importance: existing[0].importance,
			createdByModel: false,
			lastConfirmedAt: new Date(),
			embedding,
		})
			.returning();
		if (!created[0]) { return false; }
		await getDb().update(memories).set({ supersededBy: created[0].id, updatedAt: new Date() })
			.where(eq(memories.id, id));
		return true;
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
			const rows = await db
				.select(MEMORY_LIST_COLUMNS)
				.from(memories)
				.where(
					and(
						eq(memories.scope, 'USER'),
						eq(memories.userSnowflake, userSnowflake),
						guildSnowflake === null
							? isNull(memories.guildSnowflake)
							: eq(memories.guildSnowflake, guildSnowflake),
					),
				)
				.orderBy(desc(memories.createdAt));
			return rows.map((row) => { return { ...row, embedding: null }; }) as Memory[];
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
			const rows = await db
				.select(MEMORY_LIST_COLUMNS)
				.from(memories)
				.where(and(eq(memories.scope, 'SERVER'), eq(memories.guildSnowflake, guildSnowflake)))
				.orderBy(desc(memories.createdAt));
			return rows.map((row) => { return { ...row, embedding: null }; }) as Memory[];
		} catch (error) {
			Logger.error('[MemoryService] Failed to list memories for server:', error);
			throw new Error(`Failed to list memories for server: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Delete a memory by ID only if it belongs to the given guild (admin/server-scoped delete).
	 * Prevents cross-guild deletion.
	 *
	 * @param id - The memory UUID
	 * @param guildSnowflake - The guild ID that must own the memory
	 * @returns true if a memory was deleted
	 */
	public async forgetByIdForGuild(id: string, guildSnowflake: string): Promise<boolean> {
		const db = getDb();

		try {
			const result = await db
				.delete(memories)
				.where(and(eq(memories.id, id), eq(memories.guildSnowflake, guildSnowflake)))
				.returning();
			return result.length > 0;
		} catch (error) {
			Logger.error(`[MemoryService] Failed to forget memory ${id} for guild ${guildSnowflake}:`, error);
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
	public async forgetByIdForUser(id: string, userSnowflake: string, guildSnowflake: string | null): Promise<boolean> {
		const db = getDb();

		try {
			const result = await db
				.delete(memories)
				.where(and(
					eq(memories.id, id),
					eq(memories.userSnowflake, userSnowflake),
					guildSnowflake === null ? isNull(memories.guildSnowflake) : eq(memories.guildSnowflake, guildSnowflake),
				))
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
	public async forgetAllForUser(userSnowflake: string, guildSnowflake: string | null): Promise<number> {
		const db = getDb();

		try {
			const result = await db
				.delete(memories)
				.where(and(
					eq(memories.userSnowflake, userSnowflake),
					guildSnowflake === null ? isNull(memories.guildSnowflake) : eq(memories.guildSnowflake, guildSnowflake),
				))
				.returning();
			return result.length;
		} catch (error) {
			Logger.error('[MemoryService] Failed to forget all memories for user:', error);
			throw new Error(`Failed to forget memories: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Delete all SERVER-scoped memories belonging to a guild (admin/server-scoped
	 * delete). Constrained to SERVER scope so it only clears the server memories an
	 * admin can see via {@link listForServer}, never users' private USER memories.
	 *
	 * @param guildSnowflake - The guild ID
	 * @returns The number of memories deleted
	 */
	public async forgetAllForGuild(guildSnowflake: string): Promise<number> {
		const db = getDb();

		try {
			const result = await db
				.delete(memories)
				.where(and(eq(memories.scope, 'SERVER'), eq(memories.guildSnowflake, guildSnowflake)))
				.returning();
			return result.length;
		} catch (error) {
			Logger.error('[MemoryService] Failed to forget all memories for guild:', error);
			throw new Error(`Failed to forget memories: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}
}
