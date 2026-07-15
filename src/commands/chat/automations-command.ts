import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';

import { areAutomationsEnabled } from '../../services/automation-settings.js';
import { ProactiveFeature, ProactivePreferencesService } from '../../services/proactive-preferences.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

const FEATURES = new Set<ProactiveFeature>([
	'dailyFishingQuests', 'rareCatchAlerts', 'weeklyFishingSummaries', 'collectionReminders', 'personalReminders',
]);

export class AutomationsCommand implements Command {
	public names = ['automations'];
	public deferType = CommandDeferType.HIDDEN;
	public requireClientPerms: PermissionsString[] = [];
	private readonly preferences = new ProactivePreferencesService();

	public async execute(intr: ChatInputCommandInteraction): Promise<void> {
		const action = intr.options.getString('action', true);
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

		const feature = intr.options.getString('feature') as ProactiveFeature | null;
		if (!feature || !FEATURES.has(feature)) {
			await InteractionUtils.send(intr, 'Choose a feature to enable, disable, or configure.', true);
			return;
		}
		const enabled = action !== 'disable';
		const updated = await this.preferences.configure({
			userSnowflake: intr.user.id,
			guildSnowflake: intr.guildId,
			feature,
			enabled,
			timezone: intr.options.getString('timezone') ?? undefined,
			quietHoursStart: intr.options.getString('quiet_start') ?? undefined,
			quietHoursEnd: intr.options.getString('quiet_end') ?? undefined,
			frequency: intr.options.getString('frequency') ?? undefined,
			destinationChannelSnowflake: intr.options.getChannel('destination')?.id ?? intr.channelId,
		});
		await InteractionUtils.send(intr, `${feature} is now ${enabled ? 'enabled' : 'disabled'}. Timezone: ${updated.timezone}.`, true);
	}
}
