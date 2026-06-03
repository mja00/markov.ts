import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ChatInputCommandInteraction,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsString,
} from 'discord.js';

import { Memory } from '../../db/schema.js';
import { MemoryOption } from '../../enums/index.js';
import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger } from '../../services/index.js';
import { MemoryService } from '../../services/memory.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

const ITEMS_PER_PAGE = 5;
const CONTENT_PREVIEW_LENGTH = 200;

export class MemoriesCommand implements Command {
	public names = [Lang.getRef('chatCommands.memories', Language.Default)];
	public deferType = CommandDeferType.HIDDEN;
	public requireClientPerms: PermissionsString[] = [];

	private readonly memoryService = new MemoryService();

	/**
	 * Execute the memories command. Lets a user view or forget what the bot
	 * remembers about them; admins can manage server-wide memories.
	 */
	public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
		try {
			const action = intr.options.getString(
				Lang.getRef('arguments.memoriesAction', Language.Default),
			) as MemoryOption;
			const scope = intr.options.getString(Lang.getRef('arguments.memoriesScope', Language.Default)) ?? 'mine';
			const id = intr.options.getString(Lang.getRef('arguments.memoriesId', Language.Default));

			const userSnowflake = intr.user.id;
			const guildSnowflake = intr.guildId ?? null;

			// Admin gate for server scope.
			if (scope === 'server') {
				if (!guildSnowflake) {
					await InteractionUtils.send(intr, 'Server memories aren\'t available in DMs.', true);
					return;
				}

				const isAdmin = Boolean(intr.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
				if (!isAdmin) {
					await InteractionUtils.send(
						intr,
						'Managing server memories requires the Manage Server permission.',
						true,
					);
					return;
				}
			}

			switch (action) {
				case MemoryOption.LIST: {
					const memories =
						scope === 'server'
							? await this.memoryService.listForServer(guildSnowflake as string)
							: await this.memoryService.listForUser(userSnowflake, guildSnowflake);

					if (memories.length === 0) {
						const emptyEmbed = new EmbedBuilder()
							.setTitle('🧠 Memories')
							.setDescription('No memories found.')
							.setColor(0x95_A5_A6);
						await InteractionUtils.send(intr, emptyEmbed, true);
						return;
					}

					const { embed, components } = this.buildMemoriesPage(memories, 1, scope);

					if (intr.deferred || intr.replied) {
						await intr.editReply({ embeds: [embed], components });
					} else {
						await intr.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
					}
					return;
				}
				case MemoryOption.FORGET: {
					if (!id) {
						await InteractionUtils.send(
							intr,
							'Provide the memory `id` to forget (see `/memories action:List`).',
							true,
						);
						return;
					}

					const ok =
						scope === 'server'
							? await this.memoryService.forgetByIdForGuild(id, guildSnowflake as string)
							: await this.memoryService.forgetByIdForUser(id, userSnowflake);

					await InteractionUtils.send(
						intr,
						ok ? 'Forgotten.' : 'No memory with that ID that you can forget.',
						true,
					);
					return;
				}
				case MemoryOption.FORGET_ALL: {
					const count = await this.memoryService.forgetAllForUser(userSnowflake);
					await InteractionUtils.send(
						intr,
						`Forgot ${count} ${count === 1 ? 'memory' : 'memories'}.`,
						true,
					);
					return;
				}
				default: {
					await InteractionUtils.send(intr, 'Unknown action.', true);
				}
			}
		} catch (error) {
			Logger.error('[MemoriesCommand] Error executing memories command:', error);

			const errorEmbed = new EmbedBuilder()
				.setTitle('Error')
				.setDescription('An error occurred while managing memories. Please try again later.')
				.setColor(0xFF_00_00);

			await InteractionUtils.send(intr, errorEmbed, true);
		}
	}

	/**
	 * Build a single page of memories with navigation buttons.
	 * @param memories - All memories for the current scope
	 * @param page - Current page (1-based)
	 * @param scope - The memory scope ('mine' or 'server')
	 * @returns Embed and components for the page
	 */
	private buildMemoriesPage(
		memories: Memory[],
		page: number,
		scope: string,
	): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[]; } {
		const totalPages = Math.max(1, Math.ceil(memories.length / ITEMS_PER_PAGE));
		const currentPage = Math.max(1, Math.min(page, totalPages));
		const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
		const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, memories.length);
		const pageMemories = memories.slice(startIndex, endIndex);

		const embed = new EmbedBuilder()
			.setTitle(`🧠 Memories (${scope === 'server' ? 'server' : 'mine'})`)
			.setDescription(`**Page ${currentPage}/${totalPages}**`)
			.setColor(0x34_98_DB);

		for (const [index, memory] of pageMemories.entries()) {
			const globalIndex = startIndex + index + 1;
			const content =
				memory.content.length > CONTENT_PREVIEW_LENGTH
					? `${memory.content.slice(0, CONTENT_PREVIEW_LENGTH)}…`
					: memory.content;

			embed.addFields({
				name: `${globalIndex}. [${memory.scope}]`,
				value: `${content}\nID: \`${memory.id}\``,
				inline: false,
			});
		}

		const navRow = new ActionRowBuilder<ButtonBuilder>();
		const prevButton = new ButtonBuilder()
			.setCustomId(`memories:page:${scope}:${currentPage - 1}`)
			.setLabel('◀ Previous')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(currentPage <= 1);

		const nextButton = new ButtonBuilder()
			.setCustomId(`memories:page:${scope}:${currentPage + 1}`)
			.setLabel('Next ▶')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(currentPage >= totalPages);

		navRow.addComponents(prevButton, nextButton);

		return { embed, components: [navRow] };
	}

	/**
	 * Handle memories page navigation (called from button handler).
	 * Re-fetches and re-applies the admin gate for the server scope.
	 * @param intr - Button interaction
	 * @param scope - The memory scope ('mine' or 'server')
	 * @param page - Page number to navigate to
	 */
	public async handlePageNavigation(intr: ButtonInteraction, scope: string, page: number): Promise<void> {
		try {
			const userSnowflake = intr.user.id;
			const guildSnowflake = intr.guildId ?? null;

			let memories: Memory[];
			if (scope === 'server') {
				if (!guildSnowflake) {
					await InteractionUtils.send(intr, { content: 'Server memories aren\'t available in DMs.' }, true);
					return;
				}

				const isAdmin = Boolean(intr.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
				if (!isAdmin) {
					await InteractionUtils.send(
						intr,
						{ content: 'Managing server memories requires the Manage Server permission.' },
						true,
					);
					return;
				}

				memories = await this.memoryService.listForServer(guildSnowflake);
			} else {
				memories = await this.memoryService.listForUser(userSnowflake, guildSnowflake);
			}

			const { embed, components } = this.buildMemoriesPage(memories, page, scope);

			if (intr.deferred || intr.replied) {
				await intr.editReply({ embeds: [embed], components });
			} else {
				await intr.update({ embeds: [embed], components });
			}
		} catch (error) {
			Logger.error('[MemoriesCommand] Error handling page navigation:', error);
			await InteractionUtils.send(
				intr,
				{ content: 'An error occurred while loading the memories page.' },
				true,
			);
		}
	}
}
