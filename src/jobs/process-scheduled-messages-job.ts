import { createRequire } from 'node:module';

import { Client } from 'discord.js';

import { Logger, ScheduledMessageService, areAutomationsEnabled } from '../services/index.js';
import { ClientUtils, MessageUtils } from '../utils/index.js';

import { Job } from './index.js';

const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');

/**
 * Posts due scheduled messages. Runs inside each bot instance (it needs a
 * gateway client to send), so it must be registered in start-bot.ts, not the
 * manager. With multiple shards every instance runs this; correctness comes from
 * the atomic claim, not from which shard runs first: a due row can be claimed by
 * at most one instance, so it is never posted twice. The claim happens before the
 * send, so delivery is at-most-once - a crash between claim and send drops the
 * message rather than risking a double-post.
 */
export class ProcessScheduledMessagesJob extends Job {
	public name = 'Process Scheduled Messages';
	public schedule: string = Config.jobs.processScheduledMessages.schedule;
	public log: boolean = Config.jobs.processScheduledMessages.log;
	public runOnce: boolean = Config.jobs.processScheduledMessages.runOnce;
	public initialDelaySecs: number = Config.jobs.processScheduledMessages.initialDelaySecs;

	private readonly scheduledMessageService = new ScheduledMessageService();

	constructor(private client: Client) {
		super();
	}

	public async run(): Promise<void> {
		if (!areAutomationsEnabled()) {
			return;
		}
		const due = await this.scheduledMessageService.getDue(new Date());

		for (const message of due) {
			try {
				// Claim first so only one instance does the channel fetch + send.
				const won = await this.scheduledMessageService.claimDue(message.id);
				if (!won) {
					continue;
				}

				const channel = await ClientUtils.getChannel(this.client, message.channelSnowflake);
				if (!channel || !channel.isTextBased()) {
					// Channel gone or not sendable: the claim already moved it out of
					// PENDING, so record the failure instead of leaving it as "sent".
					await this.scheduledMessageService.markFailed(message.id);
					continue;
				}

				const sent = await MessageUtils.send(channel, {
					content: message.content,
					// Fires later with no human in the loop, so never let it mass-ping.
					allowedMentions: { parse: ['users'] },
				});
				if (!sent) {
					await this.scheduledMessageService.markFailed(message.id);
				}
			} catch (error) {
				Logger.error(`[ProcessScheduledMessagesJob] Failed to send scheduled message ${message.id}:`, error);
				await this.scheduledMessageService.markFailed(message.id);
			}
		}
	}
}
