import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';

import { Language } from '../../models/enum-helpers/index.js';
import { Lang, OpenAIService } from '../../services/index.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

export class ResetCommand implements Command {
	public names = [Lang.getRef('chatCommands.reset', Language.Default)];
	public deferType = CommandDeferType.HIDDEN;
	public requireClientPerms: PermissionsString[] = [];

	public async execute(intr: ChatInputCommandInteraction): Promise<void> {
		const openai = await OpenAIService.getInstance();
		await openai.resetPrivateConversation({
			guildSnowflake: intr.guildId ?? null,
			channelSnowflake: intr.channelId,
			userSnowflake: intr.user.id,
		});
		await InteractionUtils.send(intr, 'Your conversation context in this channel has been reset.', true);
	}
}
