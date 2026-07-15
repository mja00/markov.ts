import { randomUUID } from 'node:crypto';

import {
	and,
	eq,
	isNull,
	lt,
	or,
} from 'drizzle-orm';

import { getDb } from './database.service.js';
import { ConversationContext, conversationContexts } from '../db/schema.js';

export type PrivateContextIdentity = {
	guildSnowflake: string | null;
	channelSnowflake: string;
	userSnowflake: string;
};

export type ContextState = Pick<ConversationContext, 'lastResponseId' | 'messageCount' | 'expiresAt'>;

export type ConversationContextOptions = {
	expiryMs?: number;
	lockMs?: number;
	lockWaitMs?: number;
	maxMessages?: number;
	pollMs?: number;
};

const delay = async (milliseconds: number): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, milliseconds);
	});
};

export class ConversationContextService {
	private readonly expiryMs: number;
	private readonly lockMs: number;
	private readonly lockWaitMs: number;
	private readonly maxMessages: number;
	private readonly pollMs: number;

	constructor(options: ConversationContextOptions = {}) {
		this.expiryMs = options.expiryMs ?? 24 * 60 * 60 * 1000;
		this.lockMs = options.lockMs ?? 2 * 60 * 1000;
		this.lockWaitMs = options.lockWaitMs ?? 2 * 60 * 1000;
		this.maxMessages = options.maxMessages ?? 40;
		this.pollMs = options.pollMs ?? 100;
	}

	public static privateKey(identity: PrivateContextIdentity): string {
		return ['private', identity.guildSnowflake ?? 'dm', identity.channelSnowflake, identity.userSnowflake].join(':');
	}

	public static publicKey(guildSnowflake: string | null, channelSnowflake: string): string {
		return ['public', guildSnowflake ?? 'dm', channelSnowflake].join(':');
	}

	public async withPrivateContext<T>(
		identity: PrivateContextIdentity,
		callback: (state: ContextState) => Promise<{ result: T; lastResponseId: string | null; }>,
	): Promise<T> {
		const contextKey = ConversationContextService.privateKey(identity);
		const token = randomUUID();
		const deadline = Date.now() + this.lockWaitMs;
		let context: ConversationContext | undefined;

		while (!context && Date.now() < deadline) {
			context = await this.claim(contextKey, identity, token);
			if (!context) {
				await delay(this.pollMs);
			}
		}

		if (!context) {
			throw new Error('Conversation context is busy. Please try again.');
		}

		const expired = context.expiresAt.getTime() <= Date.now();
		const capped = context.messageCount >= this.maxMessages;
		const state: ContextState = {
			lastResponseId: expired || capped ? null : context.lastResponseId,
			messageCount: expired || capped ? 0 : context.messageCount,
			expiresAt: context.expiresAt,
		};

		try {
			const completed = await callback(state);
			await getDb().update(conversationContexts).set({
				lastResponseId: completed.lastResponseId,
				messageCount: state.messageCount + 1,
				expiresAt: new Date(Date.now() + this.expiryMs),
				lockToken: null,
				lockedUntil: null,
				updatedAt: new Date(),
			})
				.where(and(eq(conversationContexts.contextKey, contextKey), eq(conversationContexts.lockToken, token)));
			return completed.result;
		} catch (error) {
			await getDb().update(conversationContexts).set({ lockToken: null, lockedUntil: null, updatedAt: new Date() })
				.where(and(eq(conversationContexts.contextKey, contextKey), eq(conversationContexts.lockToken, token)));
			throw error;
		}
	}

	public async resetPrivate(identity: PrivateContextIdentity): Promise<void> {
		await getDb().delete(conversationContexts).where(eq(
			conversationContexts.contextKey,
			ConversationContextService.privateKey(identity),
		));
	}

	public async resetAll(): Promise<void> {
		await getDb().update(conversationContexts).set({
			lastResponseId: null,
			messageCount: 0,
			lockToken: null,
			lockedUntil: null,
			updatedAt: new Date(),
		});
	}

	public async resetChannel(channelSnowflake: string): Promise<void> {
		await getDb().delete(conversationContexts).where(eq(conversationContexts.channelSnowflake, channelSnowflake));
	}

	private async claim(
		contextKey: string,
		identity: PrivateContextIdentity,
		token: string,
	): Promise<ConversationContext | undefined> {
		const db = getDb();
		const now = new Date();
		await db.insert(conversationContexts).values({
			contextKey,
			type: 'PRIVATE',
			guildSnowflake: identity.guildSnowflake,
			channelSnowflake: identity.channelSnowflake,
			userSnowflake: identity.userSnowflake,
			expiresAt: new Date(Date.now() + this.expiryMs),
		}).onConflictDoNothing({ target: conversationContexts.contextKey });

		const claimed = await db.update(conversationContexts).set({
			lockToken: token,
			lockedUntil: new Date(Date.now() + this.lockMs),
			updatedAt: now,
		}).where(and(
			eq(conversationContexts.contextKey, contextKey),
			or(isNull(conversationContexts.lockedUntil), lt(conversationContexts.lockedUntil, now)),
		))
			.returning();

		return claimed[0];
	}
}
