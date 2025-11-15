import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger } from '../../services/index.js';
import { ShopService } from '../../services/shop.service.js';
import { UserService } from '../../services/user.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

export class InventoryCommand implements Command {
    public names = [Lang.getRef('chatCommands.inventory', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    private readonly userService = new UserService();
    private readonly shopService = new ShopService();

    /**
     * Execute the inventory command
     * Displays all items owned by the user
     */
    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        try {
            Logger.info(`[InventoryCommand] Inventory command executed by ${intr.user.tag}`);

            // Ensure user exists
            const user = await this.userService.ensureUserExists(intr.user.id, intr.user.tag);

            if (!user) {
                Logger.error(`[InventoryCommand] Failed to create/get user: ${intr.user.id}`);
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Failed to retrieve your user data.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed);
                return;
            }

            // Get user's inventory
            const inventoryItems = await this.shopService.getUserInventory(user.id);

            if (inventoryItems.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🎒 Your Inventory')
                    .setDescription('Your inventory is empty!\nUse `/shop` to buy items and `/buy` to purchase them.')
                    .addFields({ name: '💰 Balance', value: `${user.money} coins`, inline: true })
                    .setColor(0x95a5a6);

                await InteractionUtils.send(intr, embed);
                return;
            }

            // Build embed with inventory items
            const embed = new EmbedBuilder()
                .setTitle(`🎒 ${intr.user.tag}'s Inventory`)
                .setDescription(`You have ${inventoryItems.length} different item${inventoryItems.length === 1 ? '' : 's'}!`)
                .addFields({ name: '💰 Balance', value: `${user.money} coins`, inline: true })
                .setColor(0x9b59b6);

            // Add each inventory item as a field
            for (const { inventory, item } of inventoryItems) {
                embed.addFields({
                    name: `${item.name}`,
                    value: `**Quantity:** ${inventory.count}`,
                    inline: true,
                });
            }

            await InteractionUtils.send(intr, embed);
        } catch (error) {
            Logger.error('[InventoryCommand] Error executing inventory command:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while fetching your inventory. Please try again later.')
                .setColor(0xff0000);

            await InteractionUtils.send(intr, errorEmbed);
        }
    }
}
