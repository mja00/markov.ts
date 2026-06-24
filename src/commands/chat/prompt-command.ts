import { createRequire } from 'node:module';

import {
	ActionRowBuilder,
	ChatInputCommandInteraction,
	EmbedBuilder,
	ModalBuilder,
	PermissionsString,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';

import { PromptOption } from '../../enums/index.js';
import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger, OpenAIService } from '../../services/index.js';
import { PromptSettingsService, PromptSettingsUpdate } from '../../services/prompt-settings.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

const require = createRequire(import.meta.url);
const Config = require('../../../config/config.json');

// Keep the prompt preview under Discord's 4096-char embed description limit.
const PROMPT_PREVIEW_LENGTH = 3800;

export class PromptCommand implements Command {
	public names = [Lang.getRef('chatCommands.prompt', Language.Default)];
	// NONE so `edit` can open a modal — you cannot showModal once an interaction
	// has been deferred or replied to. The other actions reply themselves.
	public deferType = CommandDeferType.NONE;
	public requireClientPerms: PermissionsString[] = [];

	private readonly promptSettings = PromptSettingsService.getInstance();

	/**
	 * Owner-only command to view and live-tweak Markov's OpenAI prompt settings
	 * (system prompt, model, reasoning effort, verbosity, summary).
	 */
	public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
		// Owner gate — same check as /dev.
		if (!Config.developers.includes(intr.user.id)) {
			await InteractionUtils.send(intr, Lang.getEmbed('validationEmbeds.devOnly', data.lang));
			return;
		}

		const action = intr.options.getString(
			Lang.getRef('arguments.promptAction', Language.Default),
		) as PromptOption;

		try {
			switch (action) {
				case PromptOption.VIEW: {
					await this.handleView(intr);
					return;
				}
				case PromptOption.EDIT: {
					await this.handleEdit(intr);
					return;
				}
				case PromptOption.SET: {
					await this.handleSet(intr);
					return;
				}
				case PromptOption.RESET: {
					await this.promptSettings.reset();
					await this.clearConversations();
					await InteractionUtils.send(
						intr,
						'Prompt settings reset to defaults. Applies to new conversations; across shards within ~30s.',
						true,
					);
					return;
				}
				default: {
					await InteractionUtils.send(intr, 'Unknown action.', true);
				}
			}
		} catch (error) {
			Logger.error('[PromptCommand] Error executing prompt command:', error);
			// Validation errors carry user-facing messages; surface them directly.
			const message = error instanceof Error ? error.message : 'An error occurred.';
			await InteractionUtils.send(intr, message, true);
		}
	}

	private async handleView(intr: ChatInputCommandInteraction): Promise<void> {
		const settings = await this.promptSettings.get();
		const prompt = settings.systemPrompt.length > PROMPT_PREVIEW_LENGTH
			? `${settings.systemPrompt.slice(0, PROMPT_PREVIEW_LENGTH)}…`
			: settings.systemPrompt;

		const embed = new EmbedBuilder()
			.setTitle('🗿 Prompt settings')
			.setColor(0x34_98_DB)
			.setDescription(`\`\`\`\n${prompt}\n\`\`\``)
			.addFields(
				{ name: 'Model', value: settings.model, inline: true },
				{ name: 'Reasoning effort', value: settings.reasoningEffort ?? 'off', inline: true },
				{ name: 'Verbosity', value: settings.verbosity ?? 'off', inline: true },
				{ name: 'Summary', value: settings.reasoningSummary ?? 'off', inline: true },
			);

		await InteractionUtils.send(intr, embed, true);
	}

	private async handleEdit(intr: ChatInputCommandInteraction): Promise<void> {
		const settings = await this.promptSettings.get();

		const input = new TextInputBuilder()
			.setCustomId('systemPrompt')
			.setLabel('System prompt')
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(true)
			.setMaxLength(4000)
			.setValue(settings.systemPrompt.slice(0, 4000));

		const modal = new ModalBuilder()
			.setCustomId('prompt:edit:system')
			.setTitle('Edit system prompt')
			.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

		await intr.showModal(modal);
	}

	private async handleSet(intr: ChatInputCommandInteraction): Promise<void> {
		const partial: PromptSettingsUpdate = {};

		const model = intr.options.getString(Lang.getRef('arguments.promptModel', Language.Default));
		const effort = intr.options.getString(Lang.getRef('arguments.promptEffort', Language.Default));
		const verbosity = intr.options.getString(Lang.getRef('arguments.promptVerbosity', Language.Default));
		const summary = intr.options.getString(Lang.getRef('arguments.promptSummary', Language.Default));

		if (model !== null) {
			partial.model = model;
		}
		if (effort !== null) {
			partial.reasoningEffort = effort;
		}
		if (verbosity !== null) {
			partial.verbosity = verbosity;
		}
		if (summary !== null) {
			partial.reasoningSummary = summary;
		}

		if (Object.keys(partial).length === 0) {
			await InteractionUtils.send(intr, 'Provide at least one setting to change (model, effort, verbosity, or summary).', true);
			return;
		}

		await this.promptSettings.update(partial);
		await this.clearConversations();
		await InteractionUtils.send(
			intr,
			'Updated. Applies to new conversations; across shards within ~30s.',
			true,
		);
	}

	// Reset conversation chains so the change takes effect on the next message
	// instead of being shadowed by an in-flight previous_response_id.
	private async clearConversations(): Promise<void> {
		const openai = await OpenAIService.getInstance();
		openai.clearConversation();
	}
}
