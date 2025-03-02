import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

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
        const embed = new EmbedBuilder()
            .setTitle('Fishing Removed')
            .setDescription('The fishing feature has been removed.')
            .setColor('#FF0000');
            
        await InteractionUtils.send(intr, embed);
    }
}
