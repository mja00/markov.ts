import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class FishCommand implements Command {
    public names = [Lang.getRef('chatCommands.fish', Language.Default)];
    public cooldown = new RateLimiter(4, 60000);
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        Logger.info(`Fish command executed by ${intr.user.tag}`);
        
        const embed = new EmbedBuilder()
            .setTitle('Fishing Removed')
            .setDescription('The fishing feature has been removed.')
            .setColor('#FF0000');
            
        await InteractionUtils.send(intr, embed);
    }
}
