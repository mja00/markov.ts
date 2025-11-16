import {
    ApplicationCommandOptionChoiceData,
    AutocompleteFocusedOption,
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionsString,
} from 'discord.js';

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
     * Autocomplete handler for the buy command
     * Suggests item slugs that are available in the shop
     */
    public async autocomplete(
        intr: AutocompleteInteraction,
        option: AutocompleteFocusedOption
    ): Promise<ApplicationCommandOptionChoiceData[]> {
        try {
            // Only handle autocomplete for the buy argument
            if (option.name !== Lang.getRef('arguments.buy', Language.Default)) {
                return [];
            }

            const userInput = typeof option.value === 'string' ? option.value.toLowerCase() : '';

            // Get all shop items
            const shopItems = await this.shopService.getShopItems();

            // Filter and map to choices
            const filteredItems = shopItems.filter((shopItem) => {
                // Only show items that have slugs
                if (!shopItem.item.slug) {
                    return false;
                }

                // Filter by slug or name if user has typed something
                if (!userInput) {
                    return true;
                }

                const slug = shopItem.item.slug.toLowerCase();
                const name = shopItem.item.name.toLowerCase();

                return slug.includes(userInput) || name.includes(userInput);
            });

            const choices: ApplicationCommandOptionChoiceData[] = filteredItems
                .map((shopItem) => {
                    // TypeScript knows slug is not null here due to filter above
                    const slug = shopItem.item.slug;
                    if (!slug) {
                        return null;
                    }
                    const displayName = `${shopItem.item.name} (${shopItem.shop.cost} coins)`;

                    return {
                        name: displayName,
                        value: slug,
                    } as ApplicationCommandOptionChoiceData;
                })
                .filter((choice): choice is ApplicationCommandOptionChoiceData => choice !== null)
                .slice(0, 25); // Discord limit is 25 choices

            return choices;
        } catch (error) {
            Logger.error('[BuyCommand] Error in autocomplete:', error);
            return [];
        }
    }

    /**
     * Execute the buy command
     * Allows users to purchase items from the shop
     */
    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        try {
            Logger.info(`[BuyCommand] Buy command executed by ${intr.user.tag}`);

            // Get the shop item identifier (ID or slug) argument
            const identifier = intr.options.getString(Lang.getRef('arguments.buy', Language.Default));
            const quantity = intr.options.getInteger(Lang.getRef('arguments.buyQuantity', Language.Default)) || 1;

            if (!identifier) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Please provide a valid shop item ID or slug.\nUse `/shop` to see available items.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed);
                return;
            }

            if (quantity < 1) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Quantity must be at least 1.')
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

            // Get shop item details by ID or slug
            const shopItem = await this.shopService.getShopItemByIdOrSlug(identifier);

            if (!shopItem) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Shop item not found. Please check the item ID or slug and try again.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed);
                return;
            }

            // Attempt to purchase
            try {
                const result = await this.shopService.purchaseItem(user.id, identifier, quantity);

                // Get updated user balance
                const updatedUser = await this.userService.getUserById(user.id);

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

                await InteractionUtils.send(intr, embed);

                Logger.info(`[BuyCommand] ${intr.user.tag} purchased ${quantity} x ${shopItem.item.name} for ${totalCost} coins`);
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
