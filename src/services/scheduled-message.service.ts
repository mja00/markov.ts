import {
	and,
	asc,
	eq,
	lte,
} from 'drizzle-orm';
import { DateTime } from 'luxon';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { ScheduledMessage, scheduledMessages } from '../db/schema.js';

// Guardrails. Markov drives this tool autonomously, so the bounds protect against
// runaway scheduling (e.g. a loop scheduling thousands) and nonsensical times.
const MIN_LEAD_SECONDS = 30;
const MAX_LEAD_DAYS = 30;
const MAX_PENDING_PER_CHANNEL = 20;
const MAX_CONTENT_LENGTH = 2000; // Discord's single-message limit.

export interface ScheduleMessageInput {
	channelSnowflake: string;
	guildSnowflake: string | null;
	createdBySnowflake: string | null;
	content: string;
	scheduledAt: Date;
}

/**
 * Service for messages Markov schedules to post later. The DB row is the source
 * of truth; {@link claimDue} provides the atomic, shard-safe handoff to the
 * sender so a message fires exactly once.
 */
export class ScheduledMessageService {
	/**
	 * Persist a new scheduled message after validating content and timing.
	 * Throws a descriptive Error on any guardrail violation; the tool handler
	 * surfaces that message back to the model so it can correct itself.
	 *
	 * @param input - Channel/guild context, author, content, and the resolved absolute send time
	 * @returns The stored PENDING row
	 */
	public async schedule(input: ScheduleMessageInput): Promise<ScheduledMessage> {
		const db = getDb();

		const content = input.content?.trim();
		if (!content) {
			throw new Error('The message content is empty.');
		}
		if (content.length > MAX_CONTENT_LENGTH) {
			throw new Error(`The message is too long (max ${MAX_CONTENT_LENGTH} characters).`);
		}

		const now = DateTime.now();
		const target = DateTime.fromJSDate(input.scheduledAt);
		if (!target.isValid) {
			throw new Error('The scheduled time is invalid.');
		}
		if (target < now.plus({ seconds: MIN_LEAD_SECONDS })) {
			throw new Error(`The scheduled time must be at least ${MIN_LEAD_SECONDS} seconds in the future.`);
		}
		if (target > now.plus({ days: MAX_LEAD_DAYS })) {
			throw new Error(`The scheduled time can be at most ${MAX_LEAD_DAYS} days away.`);
		}

		try {
			const pending = await this.listPending(input.channelSnowflake);
			if (pending.length >= MAX_PENDING_PER_CHANNEL) {
				throw new Error(`This channel already has the maximum of ${MAX_PENDING_PER_CHANNEL} pending scheduled messages.`);
			}

			const created = await db
				.insert(scheduledMessages)
				.values({
					channelSnowflake: input.channelSnowflake,
					guildSnowflake: input.guildSnowflake,
					createdBySnowflake: input.createdBySnowflake,
					content,
					scheduledAt: input.scheduledAt,
				})
				.returning();

			Logger.debug(`[ScheduledMessageService] Scheduled message ${created[0]?.id} for ${target.toISO()}`);
			return created[0];
		} catch (error) {
			// Re-throw guardrail errors verbatim; wrap unexpected DB failures.
			if (error instanceof Error && error.message.startsWith('This channel already has')) {
				throw error;
			}
			Logger.error('[ScheduledMessageService] Failed to schedule message:', error);
			throw new Error(`Failed to schedule message: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * List the pending (not yet sent/cancelled) messages for a channel, soonest first.
	 *
	 * @param channelSnowflake - The channel to list for
	 * @returns PENDING rows ordered by send time
	 */
	public async listPending(channelSnowflake: string): Promise<ScheduledMessage[]> {
		const db = getDb();

		try {
			return await db
				.select()
				.from(scheduledMessages)
				.where(and(
					eq(scheduledMessages.channelSnowflake, channelSnowflake),
					eq(scheduledMessages.status, 'PENDING'),
				))
				.orderBy(asc(scheduledMessages.scheduledAt));
		} catch (error) {
			Logger.error('[ScheduledMessageService] Failed to list pending messages:', error);
			throw new Error(`Failed to list scheduled messages: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Cancel a pending message. Scoped to the channel so Markov can only cancel
	 * messages belonging to the conversation he is in. Atomic guard on status
	 * means a message already sent/cancelled cannot be cancelled again.
	 *
	 * @param id - The scheduled message UUID
	 * @param channelSnowflake - The channel that must own the message
	 * @returns true if a pending message was cancelled
	 */
	public async cancel(id: string, channelSnowflake: string): Promise<boolean> {
		const db = getDb();

		try {
			const cancelled = await db
				.update(scheduledMessages)
				.set({ status: 'CANCELLED', updatedAt: new Date() })
				.where(and(
					eq(scheduledMessages.id, id),
					eq(scheduledMessages.channelSnowflake, channelSnowflake),
					eq(scheduledMessages.status, 'PENDING'),
				))
				.returning({ id: scheduledMessages.id });
			return cancelled.length > 0;
		} catch (error) {
			Logger.error(`[ScheduledMessageService] Failed to cancel message ${id}:`, error);
			throw new Error(`Failed to cancel scheduled message: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Fetch messages whose time has arrived and are still pending. The job calls
	 * this, then races to {@link claimDue} each one.
	 *
	 * @param now - The current time (messages with scheduledAt <= now are due)
	 * @returns Due PENDING rows, soonest first
	 */
	public async getDue(now: Date): Promise<ScheduledMessage[]> {
		const db = getDb();

		try {
			return await db
				.select()
				.from(scheduledMessages)
				.where(and(
					eq(scheduledMessages.status, 'PENDING'),
					lte(scheduledMessages.scheduledAt, now),
				))
				.orderBy(asc(scheduledMessages.scheduledAt));
		} catch (error) {
			Logger.error('[ScheduledMessageService] Failed to fetch due messages:', error);
			throw new Error(`Failed to fetch due scheduled messages: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Atomically claim a due message for sending. The status guard makes this the
	 * exactly-once primitive: when several shards run the job concurrently, only
	 * the one whose UPDATE flips PENDING -> SENT gets a row back and proceeds to send.
	 *
	 * @param id - The scheduled message UUID
	 * @returns true if this caller won the claim
	 */
	public async claimDue(id: string): Promise<boolean> {
		const db = getDb();

		try {
			const claimed = await db
				.update(scheduledMessages)
				.set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date() })
				.where(and(
					eq(scheduledMessages.id, id),
					eq(scheduledMessages.status, 'PENDING'),
				))
				.returning({ id: scheduledMessages.id });
			return claimed.length > 0;
		} catch (error) {
			Logger.error(`[ScheduledMessageService] Failed to claim message ${id}:`, error);
			throw new Error(`Failed to claim scheduled message: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
		}
	}

	/**
	 * Mark a claimed message as FAILED when the actual Discord send did not
	 * succeed. Leaves it out of future sweeps so a broken send is not retried forever.
	 *
	 * @param id - The scheduled message UUID
	 */
	public async markFailed(id: string): Promise<void> {
		const db = getDb();

		try {
			await db
				.update(scheduledMessages)
				.set({ status: 'FAILED', updatedAt: new Date() })
				.where(eq(scheduledMessages.id, id));
		} catch (error) {
			Logger.error(`[ScheduledMessageService] Failed to mark message ${id} as failed:`, error);
		}
	}
}
