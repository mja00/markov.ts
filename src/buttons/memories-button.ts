import { ButtonInteraction, MessageFlags } from 'discord.js';

import { Button, ButtonDeferType } from './button.js';
import { MemoriesCommand } from '../commands/chat/memories-command.js';
import { EventData } from '../models/internal-models.js';
import { Logger } from '../services/logger.js';

export class MemoriesButton implements Button {
	public ids = ['memories:page'];
	public deferType = ButtonDeferType.NONE;
	public requireGuild = false;
	public requireEmbedAuthorTag = false;

	private readonly memoriesCommand = new MemoriesCommand();

	public async execute(intr: ButtonInteraction, _data: EventData): Promise<void> {
		const customId = intr.customId;

		try {
			if (customId.startsWith('memories:page:')) {
				await intr.deferUpdate();

				const parts = customId.split(':');
				const scope = parts[2];
				const page = Number.parseInt(parts[3], 10);

				if (Number.isNaN(page) || page < 1) {
					await intr.followUp({
						content: 'Invalid page number.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				await this.memoriesCommand.handlePageNavigation(intr, scope, page);
			}
		} catch (error) {
			Logger.error('[MemoriesButton] Error handling memories button:', error);
			if (!intr.replied && !intr.deferred) {
				await intr.reply({
					content: 'An error occurred while processing your request.',
					flags: MessageFlags.Ephemeral,
				});
			} else if (intr.deferred) {
				await intr.followUp({
					content: 'An error occurred while processing your request.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	}
}
