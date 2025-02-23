import { Message, PartialGroupDMChannel } from 'discord.js';

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
        const userTag = msg.author.tag;
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
            const openAI = OpenAIService.getInstance();
            const thread = await openAI.createThread(channelID);
            // If there's attachments on the message, grab the first image and add it to the thread
            if (msg.attachments.size > 0) {
                let imageUrl: string;
                for (const attachment of msg.attachments.values()) {
                    if (attachment.contentType.startsWith('image/')) {
                        imageUrl = attachment.url;
                        break;
                    }
                }
                await openAI.addThreadMessageWithImage(thread, message, imageUrl, userTag);
            } else {
                await openAI.addThreadMessage(thread, message, userTag);
            }
            const startTime = Date.now();
            const run = await openAI.createThreadRun(thread);
            const messages = await openAI.handleRun(run, thread);
            clearInterval(typingInterval);
            const endTime = Date.now();
            const computationTime = endTime - startTime;
            // Occurs during a failed run. Info will be logged in the console.
            if (!messages) {
                Logger.error('No messages returned');
                await msg.reply('An error occurred while processing your request. Please try again later.');
                return;
            }
            // Print the messages
            for (const message of messages.data) {
                if (message.role !== 'assistant') {
                    continue;
                }
                if (message.content[0].type === 'text') {
                    Logger.info(`[OpenAI]: ${message.role} - ${message.content[0].text.value}`);
                    // console.log(JSON.stringify(message, null, 2));
                    // We now need to send that message to the channel
                    // We can use the message.reply method to do this
                    let replyMessage = message.content[0].text.value;
                    replyMessage += `\n-# This is an AI response. The computation took ${prettyMs(computationTime)}.`;
                    await msg.reply(replyMessage);
                    break;
                }
            }
        }

        // Process trigger
        await this.triggerHandler.process(msg);
    }
}
