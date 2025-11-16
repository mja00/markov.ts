import { ActionRowBuilder, ButtonInteraction, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

import { Button, ButtonDeferType } from './button.js';
import { ShopCommand } from '../commands/chat/shop-command.js';
import { EventData } from '../models/internal-models.js';
import { Logger } from '../services/logger.js';

export class ShopButton implements Button {
    public ids = ['shop:page', 'shop:buy'];
    public deferType = ButtonDeferType.NONE; // We'll handle defer manually based on button type
    public requireGuild = false;
    public requireEmbedAuthorTag = false;

    private readonly shopCommand = new ShopCommand();

    public async execute(intr: ButtonInteraction, _data: EventData): Promise<void> {
        const customId = intr.customId;

        try {
            if (customId.startsWith('shop:page:')) {
                // Handle page navigation - defer update
                await intr.deferUpdate();

                const pageStr = customId.split(':')[2];
                const page = parseInt(pageStr, 10);

                if (isNaN(page) || page < 1) {
                    await intr.followUp({
                        content: 'Invalid page number.',
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                await this.shopCommand.handlePageNavigation(intr, page);
            } else if (customId.startsWith('shop:buy:')) {
                // Handle buy button - show modal (don't defer, modals can't be shown after defer)
                const slug = customId.split(':').slice(2).join(':');

                if (!slug) {
                    await intr.reply({
                        content: 'Invalid item slug.',
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                // Get item details to show in modal
                const { ShopService } = await import('../services/shop.service.js');
                const shopService = new ShopService();
                const shopItem = await shopService.getShopItemBySlug(slug);

                if (!shopItem) {
                    await intr.reply({
                        content: 'Item not found.',
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                // Create modal for quantity input
                const modal = new ModalBuilder()
                    .setCustomId(`shop:buy:${slug}`)
                    .setTitle(`Buy ${shopItem.item.name}`);

                const quantityInput = new TextInputBuilder()
                    .setCustomId('quantity')
                    .setLabel('Quantity')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter quantity (default: 1)')
                    .setValue('1')
                    .setRequired(true)
                    .setMinLength(1)
                    .setMaxLength(10);

                const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(quantityInput);
                modal.addComponents(actionRow);

                await intr.showModal(modal);
            }
        } catch (error) {
            Logger.error('[ShopButton] Error handling shop button:', error);
            if (!intr.replied && !intr.deferred) {
                await intr.reply({
                    content: 'An error occurred while processing your request.',
                    flags: MessageFlags.Ephemeral,
                });
            } else if (intr.deferred) {
                await intr.followUp({
                    content: 'An error occurred while processing your request.',
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    }
}

