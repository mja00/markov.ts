import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, OpenAIService } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class GenerateImageCommand implements Command {
    public names = [Lang.getRef('chatCommands.generateImage', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        let args = {
            prompt: intr.options.getString(Lang.getRef('arguments.prompt', Language.Default)),
        };

        // Generate an image using the prompt
        const openai = OpenAIService.getInstance();
        // If there's an error here, it's most likely due to OpenAI being done with us
        try {
            const image = await openai.generateImage(args.prompt);

            await InteractionUtils.send(intr, `**${args.prompt}**\n${image}`);
        } catch (error) {
            await InteractionUtils.send(intr, `${error}`);
        }
    }
}
