import { EmbedBuilder, ModalSubmitInteraction } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';
import { createRequire } from 'node:module';

import { EventHandler } from './index.js';
import { EventDataService } from '../services/index.js';
import { Logger } from '../services/logger.js';
import { ShopService } from '../services/shop.service.js';
import { UserService } from '../services/user.service.js';
import { InteractionUtils } from '../utils/index.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');

export class ModalHandler implements EventHandler {
    private rateLimiter = new RateLimiter(
        Config.rateLimiting.buttons.amount,
        Config.rateLimiting.buttons.interval * 1000
    );

    constructor(private eventDataService: EventDataService) {}

    public async process(intr: ModalSubmitInteraction): Promise<void> {
        // Don't respond to self, or other bots
        if (intr.user.id === intr.client.user?.id || intr.user.bot) {
            return;
        }

        // Check if user is rate limited
        let limited = this.rateLimiter.take(intr.user.id);
        if (limited) {
            return;
        }

        // Handle shop buy modals
        if (intr.customId.startsWith('shop:buy:')) {
            await this.handleShopBuyModal(intr);
            return;
        }
    }

    private async handleShopBuyModal(intr: ModalSubmitInteraction): Promise<void> {
        try {
            // Parse slug from custom ID
            const slug = intr.customId.split(':').slice(2).join(':');

            if (!slug) {
                await InteractionUtils.send(intr, {
                    content: 'Invalid item slug.',
                }, true);
                return;
            }

            // Get quantity from modal
            const quantityStr = intr.fields.getTextInputValue('quantity');
            const quantity = parseInt(quantityStr, 10);

            if (isNaN(quantity) || quantity < 1) {
                await InteractionUtils.send(intr, {
                    content: 'Please enter a valid quantity (at least 1).',
                }, true);
                return;
            }

            if (quantity > 1000) {
                await InteractionUtils.send(intr, {
                    content: 'Maximum quantity is 1000.',
                }, true);
                return;
            }

            // Defer reply
            await InteractionUtils.deferReply(intr, true);

            // Ensure user exists
            const userService = new UserService();
            const user = await userService.ensureUserExists(intr.user.id, intr.user.tag);

            if (!user) {
                Logger.error(`[ModalHandler] Failed to create/get user: ${intr.user.id}`);
                await InteractionUtils.send(intr, {
                    content: 'Failed to retrieve your user data.',
                }, true);
                return;
            }

            // Get shop item details
            const shopService = new ShopService();
            const shopItem = await shopService.getShopItemByIdOrSlug(slug);

            if (!shopItem) {
                await InteractionUtils.send(intr, {
                    content: 'Shop item not found. Please check the item slug and try again.',
                }, true);
                return;
            }

            // Attempt to purchase
            try {
                const result = await shopService.purchaseItem(user.id, slug, quantity);

                // Get updated user balance
                const updatedUser = await userService.getUserById(user.id);

                const totalCost = shopItem.shop.cost * quantity;
                const quantityText = quantity > 1 ? ` x${quantity}` : '';

                const embed = new EmbedBuilder()
                    .setTitle('✅ Purchase Successful!')
                    .setDescription(`You purchased **${shopItem.item.name}**${quantityText}!`)
                    .addFields(
                        { name: 'Cost', value: `${totalCost} coins (${shopItem.shop.cost} each)`, inline: true },
                        { name: 'New Balance', value: `${updatedUser?.money || 0} coins`, inline: true },
                        { name: 'Total Quantity', value: `${result.inventory.count}`, inline: true }
                    )
                    .setColor(0x2ecc71);

                if (shopItem.item.image) {
                    embed.setThumbnail(shopItem.item.image);
                }

                await InteractionUtils.send(intr, embed, true);

                Logger.info(`[ModalHandler] ${intr.user.tag} purchased ${quantity} x ${shopItem.item.name} for ${totalCost} coins`);
            } catch (purchaseError) {
                // Handle specific purchase errors (insufficient funds, etc.)
                const errorMessage =
                    purchaseError instanceof Error ? purchaseError.message : 'An unknown error occurred';

                const embed = new EmbedBuilder()
                    .setTitle('❌ Purchase Failed')
                    .setDescription(errorMessage)
                    .addFields({ name: 'Your Balance', value: `${user.money} coins`, inline: true })
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed, true);
            }
        } catch (error) {
            Logger.error('[ModalHandler] Error handling shop buy modal:', error);

            await InteractionUtils.send(intr, {
                content: 'An error occurred while processing your purchase. Please try again later.',
            }, true);
        }
    }
}

