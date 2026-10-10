import { createRequire } from 'node:module';

import {
	ActionRowBuilder,
	ApplicationIntegrationType,
	InteractionContextType,
	Message,
	MessageContextMenuCommandInteraction,
	MessageReferenceType,
	ModalBuilder,
	ModalSubmitInteraction,
	PermissionsString,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { Language } from '../../models/enum-helpers/index.js';
import {
	Lang,
	Logger,
	ModerationService,
	OpenAIService,
} from '../../services/index.js';
import { resolveReplyBudget } from '../../services/reply-budget.js';
import { prepareMarkovReply, settleGeneratedAttachments } from '../../utils/markov-reply.js';
import { Command, CommandDeferType } from '../index.js';

import type { GeneratedAttachment } from '../../models/internal-models.js';
import type { RecentChannelMessage } from '../../utils/recent-channel-context.js';

const require = createRequire(import.meta.url);
const Config = require('../../../config/config.json');
const REPLY_TIMEOUT_MS = resolveReplyBudget(Config.replyBudget).timeoutMs;

const QUESTION_FIELD = 'question';
const DEFAULT_QUESTION = 'What do you think of this?';
const MODAL_TIMEOUT_MS = 5 * 60 * 1000;
const HEADER_QUESTION_LENGTH = 300;
const ERROR_REPLY = 'An error occurred while processing your request. Please try again later.';

export class AskMarkovCommand implements Command {
	public names = [Lang.getRef('messageCommands.askMarkov', Language.Default)];
	public cooldown = new RateLimiter(1, 10000);
	// NONE because the question modal must be the first response to the interaction.
	public deferType = CommandDeferType.NONE;
	public requireClientPerms: PermissionsString[] = [];

	constructor(
		private readonly openAI: OpenAIService,
		private readonly moderationService?: ModerationService,
	) {}

	private async askQuestion(intr: MessageContextMenuCommandInteraction): Promise<ModalSubmitInteraction | null> {
		const modalId = `ask-markov:${intr.id}`;
		const input = new TextInputBuilder()
			.setCustomId(QUESTION_FIELD)
			.setLabel('What do you want to ask?')
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(false)
			.setMaxLength(1000)
			.setPlaceholder(DEFAULT_QUESTION);
		const modal = new ModalBuilder()
			.setCustomId(modalId)
			.setTitle('Ask Markov')
			.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

		await intr.showModal(modal);
		try {
			return await intr.awaitModalSubmit({
				time: MODAL_TIMEOUT_MS,
				filter: submit => submit.customId === modalId,
			});
		} catch {
			// The user dismissed the modal or let it time out.
			return null;
		}
	}

	// A replied-to parent gives Markov the thread's context; it's unreachable when Markov isn't in the server.
	private async replyParentContext(target: Message): Promise<RecentChannelMessage[]> {
		if (target.reference?.type !== MessageReferenceType.Default || !target.reference.messageId) {
			return [];
		}
		try {
			const parent = await target.fetchReference();
			return [{
				author: parent.author.displayName,
				content: parent.content,
				isMarkov: parent.author.id === target.client.user.id,
			}];
		} catch {
			return [];
		}
	}

	public async execute(intr: MessageContextMenuCommandInteraction): Promise<void> {
		const submit = await this.askQuestion(intr);
		if (!submit) {
			return;
		}
		await submit.deferReply();

		const target = intr.targetMessage;
		const question = submit.fields.getTextInputValue(QUESTION_FIELD).trim() || DEFAULT_QUESTION;
		const channelId = intr.channelId ?? target.channelId;
		// Scheduled posts need Markov in the channel, which a user-installed invocation doesn't guarantee.
		const canPostInChannel = intr.context === InteractionContextType.BotDM
			|| intr.authorizingIntegrationOwners[ApplicationIntegrationType.GuildInstall] !== undefined;
		const imageUrl = target.attachments.values()
			.find(attachment => attachment.contentType?.startsWith('image/'))
			?.url;
		Logger.info(`[Ask Markov]: ${intr.guild?.name ?? intr.guildId ?? 'DM'} - ${intr.user.displayName} - ${question}`);

		const requestController = new AbortController();
		const requestTimeout = setTimeout(() => requestController.abort(), REPLY_TIMEOUT_MS);
		let generatedToCleanup: GeneratedAttachment[] = [];
		try {
			const startTime = Date.now();
			const response = await this.openAI.sendMessageWithReplyContext(
				channelId,
				question,
				target.author.displayName,
				target.content,
				intr.user.displayName,
				intr.user.id,
				intr.guildId,
				imageUrl,
				await this.replyParentContext(target),
				target.id,
				{ signal: requestController.signal, canPostInChannel },
			);

			const quotedQuestion = question.replaceAll(/\s+/g, ' ').slice(0, HEADER_QUESTION_LENGTH);
			const prepared = await prepareMarkovReply(this.openAI, response, {
				computationMs: Date.now() - startTime,
				moderationService: this.moderationService,
				signal: requestController.signal,
				header: `> **${intr.user.displayName}:** ${quotedQuestion}\n-# Re: ${target.url}`,
			});
			if (!prepared) {
				Logger.error('No response content or attachments generated');
				await submit.editReply({ content: ERROR_REPLY, allowedMentions: { parse: [] } });
				return;
			}
			generatedToCleanup = prepared.generated;

			await submit.editReply({
				content: prepared.content,
				files: prepared.files,
				allowedMentions: { parse: [] },
			});

			generatedToCleanup = [];
			await settleGeneratedAttachments(this.openAI, prepared);
		} catch (error) {
			// Not rethrown: the command handler would answer the already-used context menu interaction instead of this one.
			Logger.error('Error processing Ask Markov:', error);
			await this.openAI.cleanupGeneratedAttachments(generatedToCleanup);
			await submit.editReply({ content: ERROR_REPLY, allowedMentions: { parse: [] } }).catch(() => {});
		} finally {
			clearTimeout(requestTimeout);
		}
	}
}
