import {
	and,
	asc,
	desc,
	eq,
	ilike,
	inArray,
	lt,
} from 'drizzle-orm';

import { getDb } from './database.service.js';
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

export class ChannelContextService {
	constructor(
		private readonly retentionMs = 24 * 60 * 60 * 1000,
		private readonly summaryThreshold = 50,
	) {}

	public async record(input: ChannelMessageInput): Promise<void> {
		const db = getDb();
		await db.insert(channelMessages).values({
			...input,
			replyTargetSnowflake: input.replyTargetSnowflake ?? null,
			attachments: input.attachments ?? [],
			expiresAt: new Date(input.postedAt.getTime() + this.retentionMs),
		}).onConflictDoNothing();
		await db.delete(channelMessages).where(lt(channelMessages.expiresAt, new Date()));
		await this.summarizeIfNeeded(input.guildSnowflake, input.channelSnowflake);
	}

	public async recent(guildSnowflake: string, channelSnowflake: string, limit = 5, botSnowflake?: string): Promise<RecentChannelMessage[]> {
		const rows = await getDb().select().from(channelMessages)
			.where(and(
				eq(channelMessages.guildSnowflake, guildSnowflake),
				eq(channelMessages.channelSnowflake, channelSnowflake),
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
				ilike(channelMessages.content, `%${query}%`),
			))
			.orderBy(desc(channelMessages.postedAt))
			.limit(limit);
		const summaries = await getDb().select().from(conversationSummaries)
			.where(and(
				eq(conversationSummaries.guildSnowflake, guildSnowflake),
				eq(conversationSummaries.channelSnowflake, channelSnowflake),
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
			))
			.orderBy(asc(channelMessages.postedAt))
			.limit(this.summaryThreshold);
		if (rows.length < this.summaryThreshold) { return; }
		const throughMessage = rows.at(-1);
		if (!throughMessage) { return; }
		const summary = rows.map(row => `${row.authorName}: ${row.content || '[attachment]'}`).join('\n').slice(0, 8000);
		await getDb().transaction(async (tx) => {
			await tx.insert(conversationSummaries).values({
				guildSnowflake,
				channelSnowflake,
				summary,
				throughMessageSnowflake: throughMessage.messageSnowflake,
				messageCount: rows.length,
			});
			await tx.delete(channelMessages).where(inArray(
				channelMessages.messageSnowflake,
				rows.map(row => row.messageSnowflake),
			));
		});
	}
}
