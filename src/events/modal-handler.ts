import { createRequire } from 'node:module';

import { ModalSubmitInteraction } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { ShopLimits } from '../constants/shop-limits.js';
import { EventDataService, OpenAIService } from '../services/index.js';
import { Logger } from '../services/logger.js';
import { PromptSettingsService } from '../services/prompt-settings.service.js';
import { ShopService } from '../services/shop.service.js';
import { UserService } from '../services/user.service.js';
import { InteractionUtils } from '../utils/index.js';

import { EventHandler } from './index.js';

const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');

export class ModalHandler implements EventHandler {
	private rateLimiter = new RateLimiter(
		Config.rateLimiting.buttons.amount,
		Config.rateLimiting.buttons.interval * 1000,
	);

	constructor(private eventDataService: EventDataService) {}

	public async process(intr: ModalSubmitInteraction): Promise<void> {
		// Don't respond to self, or other bots
		if (intr.user.id === intr.client.user?.id || intr.user.bot) {
			return;
		}

		// Check if user is rate limited
		const limited = this.rateLimiter.take(intr.user.id);
		if (limited) {
			return;
		}

		// Handle shop buy modals
		if (intr.customId.startsWith('shop:buy:')) {
			await this.handleShopBuyModal(intr);
			return;
		}

		// Handle the owner-only system prompt editor.
		if (intr.customId === 'prompt:edit:system') {
			await this.handlePromptEditModal(intr);
		}
	}

	private async handlePromptEditModal(intr: ModalSubmitInteraction): Promise<void> {
		// Re-check the owner gate — the modal can be submitted independently of the
		// command that opened it.
		if (!Config.developers.includes(intr.user.id)) {
			await InteractionUtils.send(intr, { content: 'This is owner-only.' }, true);
			return;
		}

		try {
			const systemPrompt = intr.fields.getTextInputValue('systemPrompt');

			if (!systemPrompt || systemPrompt.trim().length === 0) {
				await InteractionUtils.send(intr, { content: 'System prompt cannot be empty.' }, true);
				return;
			}

			await PromptSettingsService.getInstance().update({ systemPrompt });

			// Clear conversation chains so the new persona takes effect immediately.
			const openai = await OpenAIService.getInstance();
			openai.clearConversation();

			await InteractionUtils.send(
				intr,
				{ content: 'System prompt updated. Applies to new conversations; across shards within ~30s.' },
				true,
			);
		} catch (error) {
			Logger.error('[ModalHandler] Error handling prompt edit modal:', error);
			const message = error instanceof Error ? error.message : 'An error occurred while saving the prompt.';
			await InteractionUtils.send(intr, { content: message }, true);
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
			const quantity = Number.parseInt(quantityStr, 10);

			if (Number.isNaN(quantity) || quantity < 1) {
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

