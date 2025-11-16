import { ModalSubmitInteraction } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';
import { createRequire } from 'node:module';

import { EventHandler } from './index.js';
import { ShopLimits } from '../constants/shop-limits.js';
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

            if (quantity > ShopLimits.MAX_PURCHASE_QUANTITY) {
                await InteractionUtils.send(intr, {
                    content: `Maximum quantity is ${ShopLimits.MAX_PURCHASE_QUANTITY}.`,
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

            // Execute purchase with response handling
            const shopService = new ShopService();
            await shopService.executePurchaseWithResponse(
                intr,
                user.id,
                intr.user.tag,
                slug,
                quantity,
                true, // Modals are ephemeral by default
            );
        } catch (error) {
            Logger.error('[ModalHandler] Error handling shop buy modal:', error);

            await InteractionUtils.send(intr, {
                content: 'An error occurred while processing your purchase. Please try again later.',
            }, true);
        }
    }
}

