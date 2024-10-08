/* eslint-disable import/no-extraneous-dependencies */
import * as fal from '@fal-ai/serverless-client';
import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';
import { createRequire } from 'node:module';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang } from '../../services/index.js';
import { Logger } from '../../services/logger.js';
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
                            .forEach(message => Logger.info(message));
                    } else {
                        Logger.info(update.status);
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

            // Just reply to the interaction
            await InteractionUtils.send(intr, `**${args.prompt}**\n${imageUrl}`);
        } catch (error) {
            await InteractionUtils.send(intr, 'Something went wrong!');
            Logger.error(error);
        }
    }
}
