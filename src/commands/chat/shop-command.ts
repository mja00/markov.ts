import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { Item } from '../../db/schema.js';
import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger } from '../../services/index.js';
import { EffectType } from '../../services/item-effects.service.js';
import { ShopService } from '../../services/shop.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

export class ShopCommand implements Command {
    public names = [Lang.getRef('chatCommands.shop', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    private readonly shopService = new ShopService();

    /**
     * Format item effect for display
     * @param item - The item to format
     * @returns Formatted effect string or empty string
     */
    private formatItemEffect(item: Item): string {
        if (!item.effectType || !item.effectValue) {
            return '';
        }

        const effectValue = parseFloat(item.effectValue);
        if (isNaN(effectValue)) {
            return '';
        }

        const typeLabel = item.isPassive ? 'Passive' : item.isConsumable ? 'Consumable' : '';

        switch (item.effectType) {
            case EffectType.RARITY_BOOST:
                return `**Effect:** ${typeLabel ? `${typeLabel} - ` : ''}+${(effectValue * 100).toFixed(0)}% rarity boost`;
            case EffectType.WORTH_MULTIPLIER:
                return `**Effect:** ${typeLabel ? `${typeLabel} - ` : ''}${effectValue.toFixed(1)}x worth multiplier`;
            default:
                return '';
        }
    }

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
                const effectText = this.formatItemEffect(item);
                const valueParts = [`**Cost:** ${shop.cost} coins`, `**ID:** \`${shop.id}\``];
                if (effectText) {
                    valueParts.push(effectText);
                }

                embed.addFields({
                    name: `${item.name}`,
                    value: valueParts.join('\n'),
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
