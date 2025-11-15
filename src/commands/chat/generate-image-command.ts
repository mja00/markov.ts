/* eslint-disable import/no-extraneous-dependencies */
import * as fal from '@fal-ai/serverless-client';
import { AttachmentBuilder, ChatInputCommandInteraction, PermissionsString } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang } from '../../services/index.js';
import { Logger } from '../../services/logger.js';
import { GeneratedImageInfo, OpenAIService } from '../../services/openai.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

const require = createRequire(import.meta.url);
let Config = require('../../../config/config.json');

fal.config({
    credentials: Config.fal.apiKey,
});

type FalResponse = {
    images: Array<{
        url: string;
        width: number;
        height: number;
        content_type: string;
    }>;
    timings: {
        inference: number;
    };
    seed: number;
    has_nsfw_concepts: Array<boolean>;
    prompt: string;
};

export class GenerateImageCommand implements Command {
    public names = [Lang.getRef('chatCommands.generateImage', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        let args = {
            prompt: intr.options.getString(Lang.getRef('arguments.prompt', Language.Default)),
        };

        const openAIService = await OpenAIService.getInstance();
        let imageInfo: GeneratedImageInfo | null = null;

        // Try OpenAI first
        try {
            Logger.debug(`Attempting to generate image with OpenAI for prompt: ${args.prompt}`);
            imageInfo = await openAIService.generateImageForPrompt(args.prompt);
            Logger.info(`Successfully generated image with OpenAI`);
        } catch (openAIError) {
            Logger.warn('OpenAI image generation failed, falling back to Fal.ai:', openAIError);

            // Fallback to Fal.ai
            try {
                const results: FalResponse = await fal.subscribe('fal-ai/flux/schnell', {
                    input: {
                        prompt: args.prompt,
                        image_size: 'landscape_4_3',
                        num_images: 1,
                        enable_safety_checker: false,
                    },
                    logs: true,
                    onQueueUpdate: update => {
                        if (update.status === 'IN_PROGRESS') {
                            update.logs
                                .map(log => log.message)
                                .forEach(message => Logger.debug(message));
                        } else {
                            Logger.debug(update.status);
                        }
                    },
                });

                // If any of them have nsfw concepts, we should NOT send the image
                if (results.has_nsfw_concepts.some(has_nsfw_concept => has_nsfw_concept)) {
                    await InteractionUtils.send(
                        intr,
                        'We generated an image. It has nsfw concepts! The URL has been logged in the console. MJ can look at it.'
                    );
                    Logger.info(`NSFW image generated: ${results.images[0].url}`);
                    return;
                }

                const imageUrl = results.images[0].url;

                // Just reply to the interaction with URL for Fal.ai fallback
                await InteractionUtils.send(intr, `**${args.prompt}**\n${imageUrl}`);
                return;
            } catch (falError) {
                // Check the error's body
                if (falError.status === 403 && falError.body?.detail?.includes('Exhausted balance')) {
                    await InteractionUtils.send(intr, 'Sorry, we\'ve run out of image generation credits. Please try again later!');
                    Logger.error('FAL API credits exhausted:', falError);
                } else {
                    await InteractionUtils.send(intr, 'Something went wrong with image generation!');
                    Logger.error('Both OpenAI and Fal.ai image generation failed:', falError);
                }
                return;
            }
        }

        // If we got here, OpenAI succeeded and we have imageInfo
        if (imageInfo) {
            try {
                // Load image from disk and create attachment
                const imageBuffer = await readFile(imageInfo.filePath);
                const attachment = new AttachmentBuilder(imageBuffer, {
                    name: imageInfo.filename,
                    description: `AI generated image: ${args.prompt}`
                });

                // Send the image with the prompt
                await InteractionUtils.send(intr, {
                    content: `**${args.prompt}**`,
                    files: [attachment]
                });

                Logger.info(`Sent generated image to Discord`);

                // Backup to Zipline and cleanup local file
                await openAIService.backupAndCleanupImages([imageInfo]);
            } catch (discordError) {
                Logger.error('Error sending image to Discord:', discordError);
                await InteractionUtils.send(intr, 'Generated the image but failed to send it. Please try again.');
                
                // Try to cleanup even if sending failed
                try {
                    await openAIService.backupAndCleanupImages([imageInfo]);
                } catch (cleanupError) {
                    Logger.error('Failed to cleanup image after Discord error:', cleanupError);
                }
            }
        }
    }
}
