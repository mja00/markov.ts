import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { FishingOption } from '../../enums/fishing-option.js';
import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang } from '../../services/lang.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

export class FishingCommand implements Command {
    public names = [Lang.getRef('chatCommands.fishing', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        let args = {
            option: intr.options.getString(
                Lang.getRef('arguments.fishing', Language.Default)
            ) as FishingOption,
        };

        let embed: EmbedBuilder;
        switch (args.option) {
            case FishingOption.STATS: {
                break;
            }
            default: {
                return;
            }
        }

        await InteractionUtils.send(intr, embed);
    }
}
