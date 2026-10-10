import { createRequire } from 'node:module';

import { Message, MessageReferenceType, PartialGroupDMChannel } from 'discord.js';


import { ChannelContextService } from '../services/channel-context.service.js';
import { ConversationTurnService } from '../services/conversation-turn.service.js';
import { Logger } from '../services/logger.js';
import { DEFAULT_MARKOV_INTENT_THRESHOLDS, MarkovIntentService } from '../services/markov-intent.service.js';
import { MarkovReactionService } from '../services/markov-reaction.service.js';
import { ModerationService } from '../services/moderation.service.js';
import { OpenAIService } from '../services/openai.js';
import { resolveReplyBudget } from '../services/reply-budget.js';
import { createTypeSafeIntentModel } from '../services/typesafe-intent.js';
import { prepareMarkovReply, settleGeneratedAttachments } from '../utils/markov-reply.js';
import { RECENT_CHANNEL_MESSAGE_LIMIT, RecentChannelMessage } from '../utils/recent-channel-context.js';

import { EventHandler, TriggerHandler } from './index.js';

import type { GeneratedAttachment } from '../models/internal-models.js';

const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');
const REPLY_TIMEOUT_MS = resolveReplyBudget(Config.replyBudget).timeoutMs;

export type MessageHandlerOptions = {
	openAI?: OpenAIService;
	moderationService?: ModerationService;
};

export class MessageHandler implements EventHandler {
	private readonly configuredOpenAI?: OpenAIService;
	private readonly moderationService?: ModerationService;
	private readonly markovIntentService = new MarkovIntentService(
		createTypeSafeIntentModel(Config.typesafe),
		{ ...DEFAULT_MARKOV_INTENT_THRESHOLDS, ...Config.typesafe?.intentThresholds },
	);
	private readonly channelContextService = new ChannelContextService({
		summarizer: async (transcript, routingKey) => {
			const openAI = this.configuredOpenAI ?? await OpenAIService.getInstance();
			return openAI.summarizeTranscript(transcript, routingKey);
		},
	});
	private readonly markovReactionService = new MarkovReactionService(async (input, candidates, routingKey) => {
		const openAI = this.configuredOpenAI ?? await OpenAIService.getInstance();
		return openAI.chooseMarkovReaction(input, candidates, routingKey);
	}, {
		enabled: Config.messageReactions?.enabled ?? true,
		cooldownMs: Math.max(0, Config.messageReactions?.cooldownSeconds ?? 30) * 1000,
	});
	private readonly conversationTurnService = new ConversationTurnService({
		enabled: Config.conversationFollowUps?.enabled ?? true,
		windowMs: Math.max(0, Config.conversationFollowUps?.windowSeconds ?? 120) * 1000,
	});
	constructor(private triggerHandler: TriggerHandler, options: MessageHandlerOptions = {}) {
		this.configuredOpenAI = options.openAI;
		this.moderationService = options.moderationService;
	}

	private async getRecentChannelMessages(msg: Message): Promise<RecentChannelMessage[]> {
		try {
			const messages = await msg.channel.messages.fetch({
				limit: RECENT_CHANNEL_MESSAGE_LIMIT,
				before: msg.id,
			});

			const recent = messages.values().toArray().toReversed();
			return recent.map((message) => {
				return {
					author: message.author.displayName,
					content: message.content,
					isMarkov: message.author.id === msg.client.user?.id,
				};
			});
		} catch (error) {
			Logger.warn('Failed to fetch recent channel messages for context:', error);
			return [];
		}
	}

	private firstImageUrl(msg: Message): string | undefined {
		return msg.attachments.values()
			.find(attachment => attachment.contentType?.startsWith('image/'))
			?.url;
	}

	public async delete(messageSnowflake: string): Promise<void> {
		await this.channelContextService.deleteMessage(messageSnowflake);
	}

	public async process(msg: Message): Promise<void> {
		// Don't respond to system messages or self
		if (msg.system || msg.author.id === msg.client.user?.id) {
			return;
		}

		// Log the server + channel + message
		const serverName = msg.guild?.name ?? 'DM';
		const channelID = msg.channel.id;
		const channelName = 'name' in msg.channel ? msg.channel.name : 'DM';
		const userTag = msg.author.displayName;
		const message = msg.content;
		const isConversationFollowUp = msg.guildId && !msg.author.bot && !msg.webhookId
			? this.conversationTurnService.consume(channelID, msg.author.id)
			: false;
		// Only count an explicit @mention of the bot: without these options,
		// @everyone/@here and role pings the bot holds also return true.
		const botMentioned = msg.client.user
			? msg.mentions.has(msg.client.user.id, { ignoreEveryone: true, ignoreRoles: true, ignoreRepliedUser: true })
			: false;
		let referencedMessage: Message | null = null;
		if (msg.reference?.type === MessageReferenceType.Default && msg.reference.messageId) {
			try {
				referencedMessage = await msg.channel.messages.fetch(msg.reference.messageId);
			} catch (error) {
				Logger.warn('Failed to fetch referenced message for intent detection:', error);
			}
		}
		const currentImageUrl = this.firstImageUrl(msg);
		const referencedImageUrl = referencedMessage
			? this.firstImageUrl(referencedMessage)
			: undefined;
		const reactionImageUrl = currentImageUrl ?? referencedImageUrl;
		const { shouldReply, shouldReact } = await this.markovIntentService.decide({
			content: message,
			botMentioned,
			isDirectMessage: !msg.guildId,
			isReplyToMarkov: referencedMessage?.author.id === msg.client.user?.id,
			isConversationFollowUp,
			referencedMessage: referencedMessage
				? {
					author: referencedMessage.author.displayName,
					content: referencedMessage.content,
				}
				: undefined,
		});
		let persistedRecentMessages: RecentChannelMessage[] = [];
		if (msg.guildId) {
			try {
				if (shouldReply || shouldReact) {
					persistedRecentMessages = await this.channelContextService.recent(
						msg.guildId,
						channelID,
						RECENT_CHANNEL_MESSAGE_LIMIT,
						msg.client.user?.id,
					);
				}
				await this.channelContextService.record({
					messageSnowflake: msg.id,
					guildSnowflake: msg.guildId,
					channelSnowflake: channelID,
					authorSnowflake: msg.author.id,
					authorName: msg.author.displayName,
					content: msg.content,
					replyTargetSnowflake: msg.reference?.messageId ?? null,
					attachments: msg.attachments.values().map((attachment) => {
						return {
							url: attachment.url, contentType: attachment.contentType,
						};
					}).toArray(),
					postedAt: msg.createdAt,
				});
				if (shouldReply) {
					await this.channelContextService.summarize(msg.guildId, channelID);
				}
			} catch (error) {
				Logger.warn('Failed to persist short-term channel context:', error);
			}
		}
		Logger.info(
			`[Message]: ${serverName} - ${channelName} - ${userTag} - ${message}`,
		);

		// If this is a PartialGroupDMChannel, just pass
		if (msg.channel instanceof PartialGroupDMChannel) {
			return await this.triggerHandler.process(msg);
		}

		const recentMessages = shouldReply || shouldReact
			? (persistedRecentMessages.length > 0
				? persistedRecentMessages
				: await this.getRecentChannelMessages(msg))
			: [];
		const reactionPromise = shouldReact
			? this.markovReactionService.react(msg, {
				content: message,
				author: userTag,
				referencedMessage: referencedMessage
					? {
						author: referencedMessage.author.displayName,
						content: referencedMessage.content,
					}
					: undefined,
				imageUrl: reactionImageUrl,
				recentMessages,
			})
			: Promise.resolve(false);

		if (shouldReply) {
			// Filter out the bot's mention and any whitespace
			const message = msg.content.replaceAll(new RegExp(`<@!?${msg.client.user?.id}>`, 'g'), '').trim();
			// Trigger the bot to start typing in that channel
			await msg.channel.sendTyping();
			const typingInterval = setInterval(() => {
				// @ts-expect-error - the channel is already validated to be able to be typed in
				msg.channel.sendTyping();
			}, 5000);
			const openAI = this.configuredOpenAI ?? await OpenAIService.getInstance();
			const requestController = new AbortController();
			const requestTimeout = setTimeout(() => requestController.abort(), REPLY_TIMEOUT_MS);
			let generatedToCleanup: GeneratedAttachment[] = [];

			try {
				const startTime = Date.now();
				let response;

				// Check if the message has any referenced messages
				if (msg.reference?.type === MessageReferenceType.Default && referencedMessage) {
					Logger.debug(`Referenced message found: ${referencedMessage.id}`);
					// Extract the referenced message content
					const referencedMessageContent = referencedMessage.content || '';
					// Check if the referenced message has image attachments
					if (referencedImageUrl) {
						Logger.debug(`Found image attachment in referenced message: ${referencedImageUrl}`);
					}
					// Send message with reply context using the new API
					response = await openAI.sendMessageWithReplyContext(
						channelID,
						message,
						referencedMessage.author.displayName,
						referencedMessageContent,
						userTag,
						msg.author.id,
						msg.guild?.id ?? null,
						referencedImageUrl,
						recentMessages,
						msg.id,
						{ signal: requestController.signal },
					);
				} else if (msg.attachments.size > 0) {
					if (currentImageUrl) {
						response = await openAI.sendMessageWithImage(channelID, message, currentImageUrl, userTag, msg.author.id, msg.guild?.id ?? null, recentMessages, msg.id, { signal: requestController.signal });
					} else {
						response = await openAI.sendMessage(channelID, message, userTag, msg.author.id, msg.guild?.id ?? null, recentMessages, msg.id, { signal: requestController.signal });
					}
				} else {
					// Regular message without attachments or replies
					response = await openAI.sendMessage(channelID, message, userTag, msg.author.id, msg.guild?.id ?? null, recentMessages, msg.id, { signal: requestController.signal });
				}

				clearInterval(typingInterval);
				const prepared = await prepareMarkovReply(openAI, response, {
					computationMs: Date.now() - startTime,
					moderationService: this.moderationService,
					signal: requestController.signal,
				});
				if (!prepared) {
					Logger.error('No response content or attachments generated');
					clearTimeout(requestTimeout);
					await msg.reply({ content: 'An error occurred while processing your request. Please try again later.', allowedMentions: { parse: [] } });
					return;
				}
				generatedToCleanup = prepared.generated;

				const sentReply = await msg.reply({
					content: prepared.content,
					files: prepared.files,
					allowedMentions: { parse: [] },
				});
				if (prepared.files.length > 0) {
					Logger.info(`Sent response with ${prepared.files.length} attachment(s) to Discord`);
				}

				if (sentReply.guildId) {
					if (!msg.author.bot && !msg.webhookId) {
						this.conversationTurnService.open(sentReply.channelId, msg.author.id);
					}
					try {
						await this.channelContextService.record({
							messageSnowflake: sentReply.id,
							guildSnowflake: sentReply.guildId,
							channelSnowflake: sentReply.channelId,
							authorSnowflake: sentReply.author.id,
							authorName: sentReply.author.displayName,
							content: sentReply.content,
							replyTargetSnowflake: msg.id,
							attachments: sentReply.attachments.values().map((attachment) => {
								return { url: attachment.url, contentType: attachment.contentType };
							}).toArray(),
							postedAt: sentReply.createdAt,
						});
					} catch (error) {
						Logger.warn('Failed to persist Markov channel response:', error);
					}
				}

				generatedToCleanup = [];
				await settleGeneratedAttachments(openAI, prepared);
				clearTimeout(requestTimeout);
			} catch (err) {
				clearInterval(typingInterval);
				clearTimeout(requestTimeout);
				Logger.error('Error processing message:', err);
				// A failed send never reaches finalization, so drop the rendered files here instead of leaking them in tmp.
				await openAI.cleanupGeneratedAttachments(generatedToCleanup);
				await msg.reply({ content: 'An error occurred while processing your request. Please try again later.', allowedMentions: { parse: [] } });
				throw err;
			}
		}

		// Reaction selection must not delay trigger execution. Keep both tasks
		// supervised while allowing them to complete independently.
		await Promise.all([
			reactionPromise,
			this.triggerHandler.process(msg),
		]);
	}
}
