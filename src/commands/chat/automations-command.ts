import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';
import { DateTime, IANAZone } from 'luxon';

import { Language } from '../../models/enum-helpers/index.js';
import { areAutomationsEnabled } from '../../services/automation-settings.js';
import { Lang } from '../../services/index.js';
import { ProactiveFeature, ProactivePreferencesService } from '../../services/proactive-preferences.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { PermissionUtils } from '../../utils/permission-utils.js';
import { Command, CommandDeferType } from '../index.js';

const FEATURES = new Set<ProactiveFeature>([
	'dailyFishingQuests', 'rareCatchAlerts', 'weeklyFishingSummaries', 'collectionReminders',
]);

function isValidTime(value: string): boolean {
	const parsed = DateTime.fromFormat(value, 'HH:mm');
	return /^\d{2}:\d{2}$/.test(value)
		&& parsed.isValid
		&& parsed.toFormat('HH:mm') === value;
}

export class AutomationsCommand implements Command {
	public names = [Lang.getRef('chatCommands.automations', Language.Default)];
	public deferType = CommandDeferType.HIDDEN;
	public requireClientPerms: PermissionsString[] = [];
	private readonly preferences = new ProactivePreferencesService();

	public async execute(intr: ChatInputCommandInteraction): Promise<void> {
		const action = intr.options.getString(Lang.getRef('arguments.automationsAction', Language.Default), true);
		if (action === 'preview') {
			const current = await this.preferences.get(intr.user.id, intr.guildId);
			const globalStatus = areAutomationsEnabled() ? 'enabled' : 'disabled';
			await InteractionUtils.send(intr, current
				? `Automations are globally **${globalStatus}**.\nCurrent preferences:\n\`\`\`json\n${JSON.stringify(current, null, 2).slice(0, 1500)}\n\`\`\``
				: `Automations are globally **${globalStatus}**. No proactive features are enabled for you.`, true);
			return;
		}
		if (!areAutomationsEnabled() && action !== 'disable') {
			await InteractionUtils.send(intr, 'Automations are globally disabled by the bot owner.', true);
			return;
		}

		const feature = intr.options.getString(Lang.getRef('arguments.automationsFeature', Language.Default)) as ProactiveFeature | null;
		if (!feature || !FEATURES.has(feature)) {
			await InteractionUtils.send(intr, 'Choose a feature to enable, disable, or configure.', true);
			return;
		}
		const timezone = intr.options.getString(Lang.getRef('arguments.automationsTimezone', Language.Default)) ?? undefined;
		const quietHoursStart = intr.options.getString(Lang.getRef('arguments.automationsQuietStart', Language.Default)) ?? undefined;
		const quietHoursEnd = intr.options.getString(Lang.getRef('arguments.automationsQuietEnd', Language.Default)) ?? undefined;
		if (timezone && !IANAZone.isValidZone(timezone)) {
			await InteractionUtils.send(intr, 'Timezone must be a valid IANA timezone, such as America/New_York.', true);
			return;
		}
		if ((quietHoursStart && !isValidTime(quietHoursStart)) || (quietHoursEnd && !isValidTime(quietHoursEnd))) {
			await InteractionUtils.send(intr, 'Quiet hours must use strict 24-hour HH:mm values.', true);
			return;
		}
		if (Boolean(quietHoursStart) !== Boolean(quietHoursEnd)) {
			await InteractionUtils.send(intr, 'Set both quiet_start and quiet_end together.', true);
			return;
		}
		const destinationOption = intr.options.getChannel(Lang.getRef('arguments.automationsDestination', Language.Default));
		let destination;
		try {
			destination = await intr.client.channels.fetch(destinationOption?.id ?? intr.channelId);
		} catch {
			destination = null;
		}
		// isSendable() is only a type guard; canSend checks the bot's actual perms.
		if (!destination?.isSendable() || !PermissionUtils.canSend(destination)) {
			await InteractionUtils.send(intr, 'Choose a destination channel where the bot can send messages.', true);
			return;
		}
		// The invoker must also be able to post there themselves, otherwise this
		// becomes a way to route recurring bot messages into read-only channels.
		if (!destination.isDMBased()) {
			let member = null;
			try {
				member = await destination.guild.members.fetch(intr.user.id);
			} catch {
				// Unfetchable member (left the guild mid-interaction): treat as no access.
			}
			if (!member || !PermissionUtils.memberCanSend(destination, member)) {
				await InteractionUtils.send(intr, 'You need permission to view and send messages in that channel to use it as an automation destination.', true);
				return;
			}
		}
		const enabled = action !== 'disable';
		const updated = await this.preferences.configure({
			userSnowflake: intr.user.id,
			guildSnowflake: intr.guildId,
			feature,
			enabled,
			timezone,
			quietHoursStart,
			quietHoursEnd,
			frequency: intr.options.getString(Lang.getRef('arguments.automationsFrequency', Language.Default)) ?? undefined,
			destinationChannelSnowflake: destination.id,
		});
		await InteractionUtils.send(intr, `${feature} is now ${enabled ? 'enabled' : 'disabled'}. Timezone: ${updated?.timezone ?? 'not set'}.`, true);
	}
}
