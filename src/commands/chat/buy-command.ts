import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger } from '../../services/index.js';
import { ShopService } from '../../services/shop.service.js';
import { UserService } from '../../services/user.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

export class BuyCommand implements Command {
    public names = [Lang.getRef('chatCommands.buy', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    private readonly userService = new UserService();
    private readonly shopService = new ShopService();

    /**
     * Execute the buy command
     * Allows users to purchase items from the shop
     */
    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        try {
            Logger.info(`[BuyCommand] Buy command executed by ${intr.user.tag}`);

            // Get the shop ID argument
            const shopId = intr.options.getString(Lang.getRef('arguments.buy', Language.Default));

            if (!shopId) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Please provide a valid shop item ID.\nUse `/shop` to see available items.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed);
                return;
            }

            // Ensure user exists
            const user = await this.userService.ensureUserExists(intr.user.id, intr.user.tag);

            if (!user) {
                Logger.error(`[BuyCommand] Failed to create/get user: ${intr.user.id}`);
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Failed to retrieve your user data.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed);
                return;
            }

            // Get shop item details
            const shopItem = await this.shopService.getShopItemById(shopId);

            if (!shopItem) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Shop item not found. Please check the item ID and try again.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed);
                return;
            }

            // Attempt to purchase
            try {
                const result = await this.shopService.purchaseItem(user.id, shopId);

                // Get updated user balance
                const updatedUser = await this.userService.getUserById(user.id);

                const embed = new EmbedBuilder()
                    .setTitle('✅ Purchase Successful!')
                    .setDescription(`You purchased **${shopItem.item.name}**!`)
                    .addFields(
                        { name: 'Cost', value: `${shopItem.shop.cost} coins`, inline: true },
                        { name: 'New Balance', value: `${updatedUser?.money || 0} coins`, inline: true },
                        { name: 'Quantity', value: `${result.inventory.count}`, inline: true }
                    )
                    .setColor(0x2ecc71);

                if (shopItem.item.image) {
                    embed.setThumbnail(shopItem.item.image);
                }

                await InteractionUtils.send(intr, embed);

                Logger.info(`[BuyCommand] ${intr.user.tag} purchased ${shopItem.item.name} for ${shopItem.shop.cost} coins`);
            } catch (purchaseError) {
                // Handle specific purchase errors (insufficient funds, etc.)
                const errorMessage =
                    purchaseError instanceof Error ? purchaseError.message : 'An unknown error occurred';

                const embed = new EmbedBuilder()
                    .setTitle('❌ Purchase Failed')
                    .setDescription(errorMessage)
                    .addFields({ name: 'Your Balance', value: `${user.money} coins`, inline: true })
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed);
            }
        } catch (error) {
            Logger.error('[BuyCommand] Error executing buy command:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while processing your purchase. Please try again later.')
                .setColor(0xff0000);

            await InteractionUtils.send(intr, errorEmbed);
        }
    }
}
