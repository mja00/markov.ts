import {
	and,
	asc,
	desc,
	eq,
	gt,
	ilike,
	inArray,
	lt,
} from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { channelMessages, conversationSummaries } from '../db/schema.js';
import { RecentChannelMessage } from '../utils/recent-channel-context.js';

export type ChannelMessageInput = {
	messageSnowflake: string;
	guildSnowflake: string;
	channelSnowflake: string;
	authorSnowflake: string;
	authorName: string;
	content: string;
	replyTargetSnowflake?: string | null;
	attachments?: Array<{ url: string; contentType: string | null; }>;
	postedAt: Date;
};

export type TranscriptSummarizer = (transcript: string, routingKey: string) => Promise<string | null>;

export type ChannelContextServiceOptions = {
	retentionMs?: number;
	summaryThreshold?: number;
	summaryTtlMs?: number;
	summarizer?: TranscriptSummarizer;
};

export class ChannelContextService {
	private readonly retentionMs: number;
	private readonly summaryThreshold: number;
	private readonly summaryTtlMs: number;
	private readonly summarizer?: TranscriptSummarizer;

	constructor(options: ChannelContextServiceOptions = {}) {
		this.retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000;
		this.summaryThreshold = options.summaryThreshold ?? 50;
		this.summaryTtlMs = options.summaryTtlMs ?? 7 * 24 * 60 * 60 * 1000;
		this.summarizer = options.summarizer;
	}

	public async record(input: ChannelMessageInput): Promise<void> {
		const db = getDb();
		await db.insert(channelMessages).values({
			...input,
			replyTargetSnowflake: input.replyTargetSnowflake ?? null,
			attachments: input.attachments ?? [],
			expiresAt: new Date(input.postedAt.getTime() + this.retentionMs),
		}).onConflictDoNothing();
	}

	public async deleteExpired(): Promise<void> {
		const now = new Date();
		await getDb().delete(channelMessages).where(lt(channelMessages.expiresAt, now));
		await getDb().delete(conversationSummaries).where(lt(conversationSummaries.expiresAt, now));
	}

	public async summarize(guildSnowflake: string, channelSnowflake: string): Promise<void> {
		await this.summarizeIfNeeded(guildSnowflake, channelSnowflake);
	}

	public async recent(guildSnowflake: string, channelSnowflake: string, limit = 5, botSnowflake?: string): Promise<RecentChannelMessage[]> {
		const rows = await getDb().select().from(channelMessages)
			.where(and(
				eq(channelMessages.guildSnowflake, guildSnowflake),
				eq(channelMessages.channelSnowflake, channelSnowflake),
				gt(channelMessages.expiresAt, new Date()),
			))
			.orderBy(desc(channelMessages.postedAt))
			.limit(limit);
		return rows.reverse().map((row) => {
			return { author: row.authorName, content: row.content, isMarkov: row.authorSnowflake === botSnowflake };
		});
	}

	public async search(guildSnowflake: string, channelSnowflake: string, query: string, limit = 10): Promise<unknown> {
		const messages = await getDb().select().from(channelMessages)
			.where(and(
				eq(channelMessages.guildSnowflake, guildSnowflake),
				eq(channelMessages.channelSnowflake, channelSnowflake),
				gt(channelMessages.expiresAt, new Date()),
				ilike(channelMessages.content, `%${query}%`),
			))
			.orderBy(desc(channelMessages.postedAt))
			.limit(limit);
		const summaries = await getDb().select().from(conversationSummaries)
			.where(and(
				eq(conversationSummaries.guildSnowflake, guildSnowflake),
				eq(conversationSummaries.channelSnowflake, channelSnowflake),
				gt(conversationSummaries.expiresAt, new Date()),
				ilike(conversationSummaries.summary, `%${query}%`),
			))
			.orderBy(desc(conversationSummaries.createdAt))
			.limit(3);
		return { messages, summaries };
	}

	public async deleteMessage(messageSnowflake: string): Promise<void> {
		await getDb().delete(channelMessages).where(eq(channelMessages.messageSnowflake, messageSnowflake));
	}

	private async summarizeIfNeeded(guildSnowflake: string, channelSnowflake: string): Promise<void> {
		const rows = await getDb().select().from(channelMessages)
			.where(and(
				eq(channelMessages.guildSnowflake, guildSnowflake),
				eq(channelMessages.channelSnowflake, channelSnowflake),
				gt(channelMessages.expiresAt, new Date()),
			))
			.orderBy(asc(channelMessages.postedAt))
			.limit(this.summaryThreshold);
		if (rows.length < this.summaryThreshold) { return; }
		const throughMessage = rows.at(-1);
		if (!throughMessage) { return; }
		// Only the AI summarizer's abstractive output may be persisted: raw
		// transcripts outlive the retention window and the MessageDelete purge,
		// so without a summarizer we skip and let messages expire naturally.
		if (!this.summarizer) { return; }
		const transcript = rows.map(row => `${row.authorName}: ${row.content || '[attachment]'}`).join('\n').slice(0, 8000);
		let summary: string | null;
		try {
			summary = await this.summarizer(transcript, channelSnowflake);
		} catch (error) {
			Logger.warn('[ChannelContextService] AI summarization failed; leaving messages to expire naturally:', error);
			return;
		}
		if (!summary) { return; }
		await getDb().transaction(async (tx) => {
			const inserted = await tx.insert(conversationSummaries).values({
				guildSnowflake,
				channelSnowflake,
				summary,
				throughMessageSnowflake: throughMessage.messageSnowflake,
				messageCount: rows.length,
				expiresAt: new Date(Date.now() + this.summaryTtlMs),
			})
				.onConflictDoNothing()
				.returning({ id: conversationSummaries.id });
			if (inserted.length === 0) { return; }
			await tx.delete(channelMessages).where(inArray(
				channelMessages.messageSnowflake,
				rows.map(row => row.messageSnowflake),
			));
		});
	}
}
