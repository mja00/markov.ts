import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionsString,
} from 'discord.js';

import { Item } from '../../db/schema.js';
import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger } from '../../services/index.js';
import { EffectType } from '../../services/item-effects.service.js';
import { ShopService } from '../../services/shop.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

const ITEMS_PER_PAGE = 4;

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
     * Build shop embed for a specific page
     * @param shopItems - All shop items
     * @param page - Current page (1-based)
     * @returns Embed and components for the page
     */
    private buildShopPage(
        shopItems: Array<{ shop: { id: string; cost: number }; item: Item }>,
        page: number
    ): {
        embed: EmbedBuilder;
        components: ActionRowBuilder<ButtonBuilder>[];
    } {
        const totalPages = Math.ceil(shopItems.length / ITEMS_PER_PAGE);
        const currentPage = Math.max(1, Math.min(page, totalPages));
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, shopItems.length);
        const pageItems = shopItems.slice(startIndex, endIndex);

        const embed = new EmbedBuilder()
            .setTitle('🏪 Fishing Shop')
            .setDescription(
                `Use the buttons below to buy items, or use \`/buy <slug>\` to purchase directly!\n**Page ${currentPage}/${totalPages}**`
            )
            .setColor(0x2ecc71);

        // Add items for this page
        for (const { shop, item } of pageItems) {
            const effectText = this.formatItemEffect(item);
            const valueParts = [`**Cost:** ${shop.cost} coins`];

            // Show slug if available, otherwise show shop ID as fallback
            if (item.slug) {
                valueParts.push(`**Slug:** \`${item.slug}\``);
            } else {
                valueParts.push(`**ID:** \`${shop.id}\``);
            }

            if (effectText) {
                valueParts.push(effectText);
            }

            embed.addFields({
                name: `${item.name}`,
                value: valueParts.join('\n'),
                inline: true,
            });
        }

        // Build navigation buttons
        const navRow = new ActionRowBuilder<ButtonBuilder>();
        const prevButton = new ButtonBuilder()
            .setCustomId(`shop:page:${currentPage - 1}`)
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage <= 1);

        const nextButton = new ButtonBuilder()
            .setCustomId(`shop:page:${currentPage + 1}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages);

        navRow.addComponents(prevButton, nextButton);

        // Build buy buttons for items on this page
        const buyRow = new ActionRowBuilder<ButtonBuilder>();
        for (const { item } of pageItems) {
            if (item.slug) {
                const buyButton = new ButtonBuilder()
                    .setCustomId(`shop:buy:${item.slug}`)
                    .setLabel(`Buy ${item.name}`)
                    .setStyle(ButtonStyle.Primary);

                buyRow.addComponents(buyButton);
            }
        }

        const components: ActionRowBuilder<ButtonBuilder>[] = [];
        if (buyRow.components.length > 0) {
            components.push(buyRow);
        }
        components.push(navRow);

        return { embed, components };
    }

    /**
     * Execute the shop command
     * Displays paginated items available for purchase
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

                await InteractionUtils.send(intr, embed, true);
                return;
            }

            // Build first page
            const { embed, components } = this.buildShopPage(shopItems, 1);

            if (intr.deferred || intr.replied) {
                await intr.followUp({
                    embeds: [embed],
                    components: components,
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await intr.reply({
                    embeds: [embed],
                    components: components,
                    flags: MessageFlags.Ephemeral,
                    fetchReply: true,
                });
            }
        } catch (error) {
            Logger.error('[ShopCommand] Error executing shop command:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while fetching shop items. Please try again later.')
                .setColor(0xff0000);

            await InteractionUtils.send(intr, errorEmbed, true);
        }
    }

    /**
     * Handle shop page navigation (called from button handler)
     * @param intr - Button interaction
     * @param page - Page number to navigate to
     */
    public async handlePageNavigation(intr: ButtonInteraction, page: number): Promise<void> {
        try {
            const shopItems = await this.shopService.getShopItems();

            if (shopItems.length === 0) {
                await InteractionUtils.send(intr, {
                    content: 'The shop is currently empty.',
                }, true);
                return;
            }

            const { embed, components } = this.buildShopPage(shopItems, page);

            // If already deferred, use editReply, otherwise use update
            if (intr.deferred || intr.replied) {
                await intr.editReply({
                    embeds: [embed],
                    components: components,
                });
            } else {
                await intr.update({
                    embeds: [embed],
                    components: components,
                });
            }
        } catch (error) {
            Logger.error('[ShopCommand] Error handling page navigation:', error);
            await InteractionUtils.send(intr, {
                content: 'An error occurred while loading the shop page.',
            }, true);
        }
    }
}
