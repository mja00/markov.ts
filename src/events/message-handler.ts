import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
	AttachmentBuilder,
	Message,
	MessageReferenceType,
	PartialGroupDMChannel,
} from 'discord.js';


import { ChannelContextService } from '../services/channel-context.service.js';
import { Logger } from '../services/logger.js';
import { MarkovIntentService } from '../services/markov-intent.service.js';
import { MarkovReactionService } from '../services/markov-reaction.service.js';
import { OpenAIService } from '../services/openai.js';
import { RECENT_CHANNEL_MESSAGE_LIMIT, RecentChannelMessage } from '../utils/recent-channel-context.js';

import { EventHandler, TriggerHandler } from './index.js';

const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');

function prettyMs(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	} else if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

export class MessageHandler implements EventHandler {
	private readonly markovIntentService = new MarkovIntentService(async (input, routingKey) => {
		const openAI = await OpenAIService.getInstance();
		return openAI.classifyMarkovIntent(input, routingKey);
	});
	private readonly channelContextService = new ChannelContextService({
		summarizer: async (transcript, routingKey) => {
			const openAI = await OpenAIService.getInstance();
			return openAI.summarizeTranscript(transcript, routingKey);
		},
	});
	private readonly markovReactionService = new MarkovReactionService(async (input, candidates, routingKey) => {
		const openAI = await OpenAIService.getInstance();
		return openAI.chooseMarkovReaction(input, candidates, routingKey);
	}, {
		enabled: Config.messageReactions?.enabled ?? true,
		cooldownMs: Math.max(0, Config.messageReactions?.cooldownSeconds ?? 30) * 1000,
	});
	constructor(private triggerHandler: TriggerHandler) {}

	public async delete(messageSnowflake: string): Promise<void> {
		await this.channelContextService.deleteMessage(messageSnowflake);
	}

	private async getRecentChannelMessages(msg: Message): Promise<RecentChannelMessage[]> {
		try {
			const messages = await msg.channel.messages.fetch({
				limit: RECENT_CHANNEL_MESSAGE_LIMIT,
				before: msg.id,
			});

			return [...messages.values()].reverse().map((message) => {
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
		return [...msg.attachments.values()]
			.find(attachment => attachment.contentType?.startsWith('image/'))
			?.url;
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
			referencedMessage: referencedMessage
				? {
					author: referencedMessage.author.displayName,
					content: referencedMessage.content,
				}
				: undefined,
			imageUrl: reactionImageUrl,
		}, channelID);
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
					attachments: [...msg.attachments.values()].map((attachment) => {
						return {
							url: attachment.url, contentType: attachment.contentType,
						};
					}),
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
			const openAI = await OpenAIService.getInstance();

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
					);
				} else if (msg.attachments.size > 0) {
					if (currentImageUrl) {
						response = await openAI.sendMessageWithImage(channelID, message, currentImageUrl, userTag, msg.author.id, msg.guild?.id ?? null, recentMessages, msg.id);
					} else {
						response = await openAI.sendMessage(channelID, message, userTag, msg.author.id, msg.guild?.id ?? null, recentMessages, msg.id);
					}
				} else {
					// Regular message without attachments or replies
					response = await openAI.sendMessage(channelID, message, userTag, msg.author.id, msg.guild?.id ?? null, recentMessages, msg.id);
				}

				clearInterval(typingInterval);
				const endTime = Date.now();
				const computationTime = endTime - startTime;

				// Get the response content with images (function calls are already handled in the service)
				const responseData = openAI.getResponseContentWithImages(response);
				const responseContent = responseData.text;
				const images = responseData.images;

				if (!responseContent && images.length === 0) {
					Logger.error('No response content or images generated');
					await msg.reply('An error occurred while processing your request. Please try again later.');
					return;
				}

				// Send the response
				Logger.debug(`[OpenAI Response]: ${responseContent}`);
				Logger.debug(`[OpenAI Images]: ${images.length} image(s) to send`);

				let replyMessage = responseContent || '';
				if (replyMessage) {
					replyMessage += `\n-# This is an AI response. The computation took ${prettyMs(computationTime)}.`;
				} else {
					replyMessage = `-# This is an AI response. The computation took ${prettyMs(computationTime)}.`;
				}

				// Prepare attachments for images
				const attachments: AttachmentBuilder[] = [];
				if (images.length > 0) {
					for (let i = 0; i < images.length; i++) {
						const imageInfo = images[i];
						Logger.debug(`Loading image ${i + 1}/${images.length} from disk: ${imageInfo.filePath}`);

						try {
							const imageBuffer = await readFile(imageInfo.filePath);
							const attachment = new AttachmentBuilder(imageBuffer, {
								name: imageInfo.filename ?? `generated-image-${i + 1}.png`,
								description: `AI generated image ${i + 1}`,
							});
							attachments.push(attachment);
							Logger.debug(`Image ${i + 1} prepared for Discord attachment`);
						} catch (error) {
							Logger.error(`Failed to prepare image ${imageInfo.filePath} for Discord`, error);
						}
					}
				}

				// Send the response with images if any
				let sentReply: Message;
				if (attachments.length > 0) {
					sentReply = await msg.reply({
						content: replyMessage,
						files: attachments,
					});
					Logger.info(`Sent response with ${attachments.length} image(s) to Discord`);
				} else {
					sentReply = await msg.reply(replyMessage);
				}

				if (sentReply.guildId) {
					try {
						await this.channelContextService.record({
							messageSnowflake: sentReply.id,
							guildSnowflake: sentReply.guildId,
							channelSnowflake: sentReply.channelId,
							authorSnowflake: sentReply.author.id,
							authorName: sentReply.author.displayName,
							content: sentReply.content,
							replyTargetSnowflake: msg.id,
							attachments: [...sentReply.attachments.values()].map((attachment) => {
								return { url: attachment.url, contentType: attachment.contentType };
							}),
							postedAt: sentReply.createdAt,
						});
					} catch (error) {
						Logger.warn('Failed to persist Markov channel response:', error);
					}
				}

				if (images.length > 0) {
					Logger.info('Backing up generated images to Zipline and cleaning up local files');
					try {
						await openAI.backupAndCleanupImages(images);
					} catch (error) {
						Logger.error('Failed to backup or cleanup generated images:', error);
					}
				}
			} catch (err) {
				clearInterval(typingInterval);
				Logger.error('Error processing message:', err);
				await msg.reply('An error occurred while processing your request. Please try again later.');
				throw err;
			}
		}

		await reactionPromise;

		// Process trigger
		await this.triggerHandler.process(msg);
	}
}
