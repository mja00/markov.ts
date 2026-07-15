import { eq } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { BotSettings, botSettings } from '../db/schema.js';
import {
	DEFAULT_MODEL,
	DEFAULT_REASONING_EFFORT,
	DEFAULT_REASONING_SUMMARY,
	DEFAULT_SYSTEM_PROMPT,
	DEFAULT_VERBOSITY,
	REASONING_EFFORT_VALUES,
	REASONING_SUMMARY_VALUES,
	VERBOSITY_VALUES,
} from '../prompts/default-prompt.js';

// The settings table is a singleton — always exactly one row, id=1.
const SINGLETON_ID = 1;

// How long a process trusts its cached settings before re-reading the DB.
// Under sharding/clustering each process caches independently, so a live edit
// made on one shard reaches the others within this window (bounded eventual
// consistency). The owner command surfaces this in its reply.
const CACHE_TTL_MS = 30000;

/**
 * Fields the owner can change live. All optional — only provided fields are
 * written. Tuning fields accept 'off' to mean "omit from the OpenAI request".
 */
export interface PromptSettingsUpdate {
	systemPrompt?: string;
	model?: string;
	reasoningEffort?: string;
	verbosity?: string;
	reasoningSummary?: string;
}

/**
 * Owns Markov's OpenAI prompt settings (model, persona, reasoning/verbosity).
 *
 * Singleton so the in-process cache is shared between OpenAIService (the reader)
 * and the `/prompt` command (the writer) — an edit refreshes the same cache the
 * next chat request reads, giving live updates without a redeploy.
 *
 * `get()` is on the hot path of every chat and MUST never throw: if the database
 * is unreachable it logs and returns the hardcoded defaults so the bot keeps
 * responding.
 */
export class PromptSettingsService {
	private static instance: PromptSettingsService | null = null;
	private cache: { value: BotSettings; fetchedAt: number; } | null = null;

	private constructor() {}

	public static getInstance(): PromptSettingsService {
		if (!PromptSettingsService.instance) {
			PromptSettingsService.instance = new PromptSettingsService();
		}
		return PromptSettingsService.instance;
	}

	/**
	 * The in-code defaults as a settings row. Used to seed the DB on first run
	 * and as the last-resort fallback when the database is unavailable.
	 */
	private defaultsRow(): BotSettings {
		return {
			id: SINGLETON_ID,
			systemPrompt: DEFAULT_SYSTEM_PROMPT,
			model: DEFAULT_MODEL,
			reasoningEffort: DEFAULT_REASONING_EFFORT,
			verbosity: DEFAULT_VERBOSITY,
			reasoningSummary: DEFAULT_REASONING_SUMMARY,
			updatedAt: new Date(),
		};
	}

	/**
	 * Get the current settings. Returns a cached value within the TTL. On a miss
	 * it reads row 1, seeding it idempotently if absent. Never throws — a DB
	 * failure falls back to the hardcoded defaults (and is not cached, so the
	 * next call retries).
	 */
	public async get(): Promise<BotSettings> {
		if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
			return this.cache.value;
		}

		try {
			const db = getDb();
			let rows = await db.select().from(botSettings).where(eq(botSettings.id, SINGLETON_ID))
				.limit(1);

			if (rows.length === 0) {
				// Idempotent seed: onConflictDoNothing makes concurrent first-boots
				// across shards safe (the losers no-op instead of hitting a PK error).
				await db.insert(botSettings).values({
					id: SINGLETON_ID,
					systemPrompt: DEFAULT_SYSTEM_PROMPT,
					model: DEFAULT_MODEL,
					reasoningEffort: DEFAULT_REASONING_EFFORT,
					verbosity: DEFAULT_VERBOSITY,
					reasoningSummary: DEFAULT_REASONING_SUMMARY,
				}).onConflictDoNothing();
				rows = await db.select().from(botSettings).where(eq(botSettings.id, SINGLETON_ID))
					.limit(1);
			}

			const value = rows[0] ?? this.defaultsRow();
			this.cache = { value, fetchedAt: Date.now() };
			return value;
		} catch (error) {
			Logger.error('[PromptSettingsService] Failed to load settings; using defaults.', error);
			return this.defaultsRow();
		}
	}

	/**
	 * Apply a partial update to the settings and refresh the local cache. Ensures
	 * the row exists first (via get()), then a plain UPDATE WHERE id=1. Throws on
	 * invalid input or DB failure so the caller can surface the error.
	 */
	public async update(partial: PromptSettingsUpdate): Promise<BotSettings> {
		this.validate(partial);

		// Guarantee the singleton row exists before updating it.
		await this.get();

		const db = getDb();
		const updated = await db
			.update(botSettings)
			.set({ ...partial, updatedAt: new Date() })
			.where(eq(botSettings.id, SINGLETON_ID))
			.returning();

		if (updated.length === 0) {
			throw new Error('Settings row was missing and could not be updated.');
		}

		this.cache = { value: updated[0], fetchedAt: Date.now() };
		return updated[0];
	}

	/**
	 * Reset all settings to the in-code defaults (a known-good, compatible combo).
	 */
	public async reset(): Promise<BotSettings> {
		return this.update({
			systemPrompt: DEFAULT_SYSTEM_PROMPT,
			model: DEFAULT_MODEL,
			reasoningEffort: DEFAULT_REASONING_EFFORT,
			verbosity: DEFAULT_VERBOSITY,
			reasoningSummary: DEFAULT_REASONING_SUMMARY,
		});
	}

	/**
	 * Validate an update before it reaches the database. Rejects empty text and
	 * out-of-set tuning values (which would otherwise be sent to the API verbatim
	 * and break every request).
	 */
	private validate(partial: PromptSettingsUpdate): void {
		if (partial.systemPrompt !== undefined && partial.systemPrompt.trim().length === 0) {
			throw new Error('System prompt cannot be empty.');
		}
		if (partial.model !== undefined && partial.model.trim().length === 0) {
			throw new Error('Model cannot be empty.');
		}
		if (partial.reasoningEffort !== undefined
			&& !(REASONING_EFFORT_VALUES as readonly string[]).includes(partial.reasoningEffort)) {
			throw new Error(`Invalid reasoning effort. Allowed: ${REASONING_EFFORT_VALUES.join(', ')}.`);
		}
		if (partial.verbosity !== undefined
			&& !(VERBOSITY_VALUES as readonly string[]).includes(partial.verbosity)) {
			throw new Error(`Invalid verbosity. Allowed: ${VERBOSITY_VALUES.join(', ')}.`);
		}
		if (partial.reasoningSummary !== undefined
			&& !(REASONING_SUMMARY_VALUES as readonly string[]).includes(partial.reasoningSummary)) {
			throw new Error(`Invalid summary mode. Allowed: ${REASONING_SUMMARY_VALUES.join(', ')}.`);
		}
	}
}
