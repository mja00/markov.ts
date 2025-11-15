import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger } from '../../services/index.js';
import { ShopService } from '../../services/shop.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

export class ShopCommand implements Command {
    public names = [Lang.getRef('chatCommands.shop', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    private readonly shopService = new ShopService();

    /**
     * Execute the shop command
     * Displays all items available for purchase
     */
    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        try {
            Logger.info(`[ShopCommand] Shop command executed by ${intr.user.tag}`);

            // Get all shop items
            const shopItems = await this.shopService.getShopItems();

            if (shopItems.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🏪 Shop')
                    .setDescription('The shop is currently empty. Check back later!')
                    .setColor(0x95a5a6);

                await InteractionUtils.send(intr, embed);
                return;
            }

            // Build embed with all shop items
            const embed = new EmbedBuilder()
                .setTitle('🏪 Fishing Shop')
                .setDescription('Use `/buy <item_id>` to purchase items with your coins!')
                .setColor(0x2ecc71);

            // Add each shop item as a field
            for (const { shop, item } of shopItems) {
                embed.addFields({
                    name: `${item.name}`,
                    value: `**Cost:** ${shop.cost} coins\n**ID:** \`${shop.id}\``,
                    inline: true,
                });
            }

            await InteractionUtils.send(intr, embed);
        } catch (error) {
            Logger.error('[ShopCommand] Error executing shop command:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while fetching shop items. Please try again later.')
                .setColor(0xff0000);

            await InteractionUtils.send(intr, errorEmbed);
        }
    }
}
