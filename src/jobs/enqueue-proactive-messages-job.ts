import { createRequire } from 'node:module';

import {
	and,
	asc,
	eq,
	gt,
	isNotNull,
	or,
} from 'drizzle-orm';
import { DateTime } from 'luxon';

import { Job } from './job.js';
import { userAssistantPreferences } from '../db/schema.js';
import { areAutomationsEnabled } from '../services/automation-settings.js';
import { getDb } from '../services/database.service.js';
import { ProactivePreferencesService } from '../services/proactive-preferences.service.js';
import { ScheduledMessageService } from '../services/scheduled-message.service.js';


const require = createRequire(import.meta.url);
type JobConfig = { jobs?: { enqueueProactiveMessages?: { schedule?: string; log?: boolean; initialDelaySecs?: number; }; }; };
let Config: JobConfig = {};
try {
	Config = require('../../config/config.json') as JobConfig;
} catch {
	// Runtime configuration is intentionally absent in CI and unit tests.
}

const PREFERENCES_PER_RUN = 100;

export class EnqueueProactiveMessagesJob extends Job {
	public name = 'Enqueue Proactive Messages';
	public schedule: string = Config.jobs?.enqueueProactiveMessages?.schedule ?? '0 0 * * * *';
	public log: boolean = Config.jobs?.enqueueProactiveMessages?.log ?? false;
	public runOnce = false;
	public initialDelaySecs: number = Config.jobs?.enqueueProactiveMessages?.initialDelaySecs ?? 20;
	private readonly preferences = new ProactivePreferencesService();
	private readonly scheduled = new ScheduledMessageService();
	private cursor?: string;

	public async run(): Promise<void> {
		if (!areAutomationsEnabled()) {
			return;
		}
		const eligibility = and(
			isNotNull(userAssistantPreferences.destinationChannelSnowflake),
			or(
				eq(userAssistantPreferences.dailyFishingQuests, true),
				eq(userAssistantPreferences.weeklyFishingSummaries, true),
				eq(userAssistantPreferences.collectionReminders, true),
			),
		);
		let preferences = await getDb().select().from(userAssistantPreferences)
			.where(this.cursor ? and(eligibility, gt(userAssistantPreferences.id, this.cursor)) : eligibility)
			.orderBy(asc(userAssistantPreferences.id))
			.limit(PREFERENCES_PER_RUN);
		if (preferences.length === 0 && this.cursor) {
			this.cursor = undefined;
			preferences = await getDb().select().from(userAssistantPreferences)
				.where(eligibility)
				.orderBy(asc(userAssistantPreferences.id))
				.limit(PREFERENCES_PER_RUN);
		}
		this.cursor = preferences.at(-1)?.id;
		for (const preference of preferences) {
			if (!preference.destinationChannelSnowflake || this.isQuiet(preference)) {
				continue;
			}
			const local = DateTime.now().setZone(preference.timezone);
			await this.enqueue(preference.dailyFishingQuests, 'daily_fishing_quest', local.toISODate() ?? local.toFormat('yyyy-MM-dd'), preference, '🎣 Your daily fishing quest is ready. Catch three fish today!');
			if (local.weekday === 1) {
				await this.enqueue(preference.weeklyFishingSummaries, 'weekly_fishing_summary', `${local.weekYear}-W${local.weekNumber}`, preference, '📊 Your weekly fishing summary is ready. Use `/fishing Stats` to see your progress.');
			}
			const reminderPeriod = preference.frequency === 'daily'
				? local.toISODate() ?? local.toFormat('yyyy-MM-dd')
				: (preference.frequency === 'monthly'
					? local.toFormat('yyyy-MM')
					: `${local.weekYear}-W${local.weekNumber}`);
			await this.enqueue(preference.collectionReminders, 'collection_reminder', reminderPeriod, preference, '🗂️ Keep building your fishing collection—ask me for your collection progress.');
		}
	}

	private async enqueue(
		enabled: boolean,
		feature: string,
		period: string,
		preference: typeof userAssistantPreferences.$inferSelect,
		content: string,
	): Promise<void> {
		if (!enabled || !preference.destinationChannelSnowflake
			|| !await this.preferences.claimDelivery(feature, preference.preferenceKey, period)) {
			return;
		}
		try {
			await this.scheduled.schedule({
				channelSnowflake: preference.destinationChannelSnowflake,
				guildSnowflake: preference.guildSnowflake,
				createdBySnowflake: preference.userSnowflake,
				content: `<@${preference.userSnowflake}> ${content}`,
				scheduledAt: DateTime.now().plus({ minutes: 1 }).toJSDate(),
			});
		} catch (error) {
			await this.preferences.releaseDelivery(feature, preference.preferenceKey, period);
			throw error;
		}
	}

	private isQuiet(preference: typeof userAssistantPreferences.$inferSelect): boolean {
		if (!preference.quietHoursStart || !preference.quietHoursEnd) {
			return false;
		}
		const now = DateTime.now().setZone(preference.timezone).toFormat('HH:mm');
		return preference.quietHoursStart <= preference.quietHoursEnd
			? now >= preference.quietHoursStart && now < preference.quietHoursEnd
			: now >= preference.quietHoursStart || now < preference.quietHoursEnd;
	}
}
