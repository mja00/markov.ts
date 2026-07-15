import { and, eq } from 'drizzle-orm';

import { areAutomationsEnabled } from './automation-settings.js';
import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { ScheduledMessageService } from './scheduled-message.service.js';
import { automationDeliveries, userAssistantPreferences } from '../db/schema.js';

export type ProactiveFeature = 'dailyFishingQuests' | 'rareCatchAlerts' | 'weeklyFishingSummaries' | 'collectionReminders' | 'personalReminders';

export class ProactivePreferencesService {
	private readonly scheduledMessages = new ScheduledMessageService();
	private static deliveryKey(feature: string, targetSnowflake: string, periodKey: string): string {
		return `${feature}:${targetSnowflake}:${periodKey}`;
	}

	public static key(userSnowflake: string, guildSnowflake: string | null): string {
		return `${guildSnowflake ?? 'dm'}:${userSnowflake}`;
	}

	public async get(userSnowflake: string, guildSnowflake: string | null) {
		const key = ProactivePreferencesService.key(userSnowflake, guildSnowflake);
		const rows = await getDb().select().from(userAssistantPreferences)
			.where(eq(userAssistantPreferences.preferenceKey, key))
			.limit(1);
		return rows[0] ?? null;
	}

	public async configure(input: {
		userSnowflake: string;
		guildSnowflake: string | null;
		feature: ProactiveFeature;
		enabled: boolean;
		timezone?: string;
		quietHoursStart?: string | null;
		quietHoursEnd?: string | null;
		frequency?: string;
		destinationChannelSnowflake?: string | null;
	}) {
		if (input.enabled && !areAutomationsEnabled()) {
			throw new Error('Automations are globally disabled.');
		}
		const preferenceKey = ProactivePreferencesService.key(input.userSnowflake, input.guildSnowflake);
		const values = {
			preferenceKey,
			userSnowflake: input.userSnowflake,
			guildSnowflake: input.guildSnowflake,
			[input.feature]: input.enabled,
			...(input.timezone ? { timezone: input.timezone } : {}),
			...(input.quietHoursStart !== undefined ? { quietHoursStart: input.quietHoursStart } : {}),
			...(input.quietHoursEnd !== undefined ? { quietHoursEnd: input.quietHoursEnd } : {}),
			...(input.frequency ? { frequency: input.frequency } : {}),
			...(input.destinationChannelSnowflake !== undefined ? { destinationChannelSnowflake: input.destinationChannelSnowflake } : {}),
			updatedAt: new Date(),
		};
		const rows = await getDb().insert(userAssistantPreferences).values(values)
			.onConflictDoUpdate({ target: userAssistantPreferences.preferenceKey, set: values })
			.returning();
		return rows[0];
	}

	public async claimDelivery(feature: string, targetSnowflake: string, periodKey: string): Promise<boolean> {
		if (!areAutomationsEnabled()) {
			return false;
		}
		const rows = await getDb().insert(automationDeliveries).values({
			dedupeKey: ProactivePreferencesService.deliveryKey(feature, targetSnowflake, periodKey), feature, targetSnowflake,
		})
			.onConflictDoNothing({ target: automationDeliveries.dedupeKey })
			.returning();
		return rows.length === 1;
	}

	public async releaseDelivery(feature: string, targetSnowflake: string, periodKey: string): Promise<void> {
		await getDb().delete(automationDeliveries).where(eq(
			automationDeliveries.dedupeKey,
			ProactivePreferencesService.deliveryKey(feature, targetSnowflake, periodKey),
		));
	}

	public async enqueueRareCatchAlerts(input: {
		guildSnowflake: string | null;
		catcherSnowflake: string;
		catchableName: string;
		rarityName: string;
		eventKey: string;
	}): Promise<void> {
		if (!areAutomationsEnabled() || !input.guildSnowflake) {
			return;
		}
		try {
			const subscribers = await getDb().select().from(userAssistantPreferences)
				.where(and(
					eq(userAssistantPreferences.guildSnowflake, input.guildSnowflake),
					eq(userAssistantPreferences.rareCatchAlerts, true),
				));
			for (const subscriber of subscribers) {
				if (!subscriber.destinationChannelSnowflake
					|| !await this.claimDelivery('rare_catch_alert', subscriber.preferenceKey, input.eventKey)) {
					continue;
				}
				try {
					await this.scheduledMessages.schedule({
						channelSnowflake: subscriber.destinationChannelSnowflake,
						guildSnowflake: input.guildSnowflake,
						createdBySnowflake: subscriber.userSnowflake,
						content: `<@${subscriber.userSnowflake}> Rare catch alert: <@${input.catcherSnowflake}> caught **${input.catchableName}** (${input.rarityName})!`,
						scheduledAt: new Date(Date.now() + 60000),
					});
				} catch (error) {
					// Failures are per-subscriber (e.g. their channel's pending cap), and
					// the one-shot eventKey means a re-throw would permanently drop the
					// remaining subscribers' alerts - release the claim and keep going.
					try {
						await this.releaseDelivery('rare_catch_alert', subscriber.preferenceKey, input.eventKey);
					} catch (releaseError) {
						Logger.warn('[ProactivePreferencesService] Failed to release rare catch delivery claim:', releaseError);
					}
					Logger.warn(`[ProactivePreferencesService] Failed to schedule rare catch alert for ${subscriber.preferenceKey}:`, error);
				}
			}
		} catch (error) {
			Logger.warn('[ProactivePreferencesService] Failed to enqueue rare catch alerts:', error);
		}
	}
}
