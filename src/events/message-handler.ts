import { Message, MessageReferenceType, PartialGroupDMChannel } from 'discord.js';

import { EventHandler, TriggerHandler } from './index.js';
import { Logger } from '../services/logger.js';
import { OpenAIService } from '../services/openai.js';

function prettyMs(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

export class MessageHandler implements EventHandler {
    constructor(private triggerHandler: TriggerHandler) {}

    public async process(msg: Message): Promise<void> {
        // Don't respond to system messages or self
        if (msg.system || msg.author.id === msg.client.user?.id) {
            return;
        }

        // Log the server + channel + message
        const serverName = msg.guild?.name ?? 'DM';
        const serverID = msg.guild?.id ?? 'DM';
        const channelID = msg.channel.id;
        const userTag = msg.author.displayName;
        const userID = msg.author.id;
        const message = msg.content;
        Logger.info(
            `[Message]: ${serverName} (${serverID}) - ${channelID} - ${userTag} (${userID}) - ${message}`
        );

        // If this is a PartialGroupDMChannel, just pass
        if (msg.channel instanceof PartialGroupDMChannel) {
            return await this.triggerHandler.process(msg);
        }

        // Check if the message has mentions
        if (msg.mentions.has(msg.client.user?.id)) {
            // Filter out the bot's mention and any whitespace
            const botMention = `<@${msg.client.user?.id}>`;
            const message = msg.content.replace(botMention, '').trim();
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
                if (msg.reference?.type === MessageReferenceType.Default) {
                    // Acquire the referenced message
                    const referencedMessage = await msg.channel.messages.fetch(msg.reference.messageId);
                    if (referencedMessage) {
                        Logger.info(`Referenced message found: ${referencedMessage.id}`);
                        // Send message with reply context using the new API
                        response = await openAI.sendMessageWithReplyContext(
                            channelID, 
                            message, 
                            referencedMessage.author.displayName,
                            userTag
                        );
                    } else {
                        // Fallback to regular message if referenced message not found
                        response = await openAI.sendMessage(channelID, message, userTag);
                    }
                } else if (msg.attachments.size > 0) {
                    // If there's attachments on the message, grab the first image and add it to the thread
                    let imageUrl: string;
                    for (const attachment of msg.attachments.values()) {
                        if (attachment.contentType?.startsWith('image/')) {
                            imageUrl = attachment.url;
                            break;
                        }
                    }
                    if (imageUrl) {
                        response = await openAI.sendMessageWithImage(channelID, message, imageUrl, userTag);
                    } else {
                        response = await openAI.sendMessage(channelID, message, userTag);
                    }
                } else {
                    // Regular message without attachments or replies
                    response = await openAI.sendMessage(channelID, message, userTag);
                }

                clearInterval(typingInterval);
                const endTime = Date.now();
                const computationTime = endTime - startTime;

                // Get the response content (function calls are already handled in the service)
                const responseContent = await openAI.getResponseContent(response);

                if (!responseContent) {
                    Logger.error('No response content generated');
                    await msg.reply('An error occurred while processing your request. Please try again later.');
                    return;
                }

                // Send the response
                Logger.info(`[OpenAI Response]: ${responseContent}`);
                let replyMessage = responseContent;
                replyMessage += `\n-# This is an AI response. The computation took ${prettyMs(computationTime)}.`;
                
                await msg.reply(replyMessage);

            } catch (err) {
                clearInterval(typingInterval);
                Logger.error('Error processing message:', err);
                await msg.reply('An error occurred while processing your request. Please try again later.');
                throw err;
            }
        }

        // Process trigger
        await this.triggerHandler.process(msg);
    }
}
