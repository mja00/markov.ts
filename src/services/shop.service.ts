import { ChatInputCommandInteraction, EmbedBuilder, ModalSubmitInteraction } from 'discord.js';
import { and, eq, gte, sql } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { UserService } from './user.service.js';
import { ShopLimits } from '../constants/shop-limits.js';
import { Inventory, inventory, InventoryInsert, Item, items, PurchaseInsert, purchases, Shop, shop, users } from '../db/schema.js';
import { InteractionUtils } from '../utils/interaction-utils.js';

/**
 * Service for managing shop and inventory operations
 */
export class ShopService {
    private readonly userService: UserService;

    constructor() {
        this.userService = new UserService();
    }

    /**
     * Get all items available in the shop
     * @returns Array of shop items with item details
     */
    public async getShopItems(): Promise<
        Array<{
            shop: Shop;
            item: Item;
        }>
    > {
        const db = getDb();

        try {
            const result = await db
                .select({
                    shop: shop,
                    item: items,
                })
                .from(shop)
                .innerJoin(items, eq(shop.itemId, items.id));

            return result;
        } catch (error) {
            Logger.error('[ShopService] Failed to get shop items:', error);
            throw new Error(`Failed to get shop items: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a shop item by shop ID
     * @param shopId - The shop entry UUID
     * @returns Shop item with item details, or null if not found
     */
    public async getShopItemById(shopId: string): Promise<{
        shop: Shop;
        item: Item;
    } | null> {
        const db = getDb();

        try {
            const result = await db
                .select({
                    shop: shop,
                    item: items,
                })
                .from(shop)
                .innerJoin(items, eq(shop.itemId, items.id))
                .where(eq(shop.id, shopId))
                .limit(1);

            return result[0] || null;
        } catch (error) {
            Logger.error(`[ShopService] Failed to get shop item ${shopId}:`, error);
            throw new Error(`Failed to get shop item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a shop item by item slug
     * @param slug - The item slug
     * @returns Shop item with item details, or null if not found
     */
    public async getShopItemBySlug(slug: string): Promise<{
        shop: Shop;
        item: Item;
    } | null> {
        const db = getDb();

        try {
            const result = await db
                .select({
                    shop: shop,
                    item: items,
                })
                .from(shop)
                .innerJoin(items, eq(shop.itemId, items.id))
                .where(eq(items.slug, slug))
                .limit(1);

            return result[0] || null;
        } catch (error) {
            Logger.error(`[ShopService] Failed to get shop item by slug ${slug}:`, error);
            throw new Error(`Failed to get shop item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a shop item by ID or slug
     * @param identifier - The shop entry UUID or slug
     * @returns Shop item with item details, or null if not found
     */
    public async getShopItemByIdOrSlug(identifier: string): Promise<{
        shop: Shop;
        item: Item;
    } | null> {
        // Check if identifier matches UUID format (8-4-4-4-12 hexadecimal pattern)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(identifier)) {
            return await this.getShopItemById(identifier);
        }
        // Otherwise try as slug
        return await this.getShopItemBySlug(identifier);
    }

    /**
     * Purchase an item from the shop
     * @param userId - The user UUID
     * @param identifier - The shop entry UUID or slug
     * @param quantity - Number of items to purchase (default: 1)
     * @returns The purchase records and updated inventory
     * @throws Error if user doesn't have enough money or item not found
     */
    public async purchaseItem(
        userId: string,
        identifier: string,
        quantity: number = 1,
    ): Promise<{
        purchases: PurchaseInsert[];
        inventory: Inventory;
    }> {
        const db = getDb();

        if (quantity < 1) {
            throw new Error('Quantity must be at least 1');
        }

        try {
            // Get shop item by ID or slug
            const shopItem = await this.getShopItemByIdOrSlug(identifier);

            if (!shopItem) {
                throw new Error('Shop item not found');
            }

            // Get user
            const user = await this.userService.getUserById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            const totalCost = shopItem.shop.cost * quantity;

            // Check if user has enough money
            if (user.money < totalCost) {
                throw new Error(`Insufficient funds. Need ${totalCost} coins, have ${user.money} coins`);
            }

            // Execute all operations in a transaction to ensure atomicity
            const result = await db.transaction(async (tx) => {
                // Subtract money from user with balance guard to prevent race conditions
                // The WHERE clause ensures the balance is still sufficient at transaction time
                const updatedUser = await tx
                    .update(users)
                    .set({
                        money: sql`${users.money} - ${totalCost}`,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(users.id, userId),
                            gte(users.money, totalCost),
                        ),
                    )
                    .returning();

                if (updatedUser.length === 0) {
                    // Either user not found or insufficient funds (race condition detected)
                    // Reload user to get current balance for error message
                    const currentUser = await tx
                        .select()
                        .from(users)
                        .where(eq(users.id, userId))
                        .limit(1);

                    if (currentUser.length === 0) {
                        throw new Error(`User ${userId} not found`);
                    }

                    throw new Error(
                        `Insufficient funds. Need ${totalCost} coins, have ${currentUser[0].money} coins`,
                    );
                }

                // Create purchase records for each item
                const purchaseRecords: PurchaseInsert[] = [];
                for (let i = 0; i < quantity; i++) {
                    purchaseRecords.push({
                        userId: userId,
                        itemId: shopItem.item.id,
                        shopId: shopItem.shop.id,
                    });
                }

                const purchaseResults = await tx.insert(purchases).values(purchaseRecords).returning();

                // Update or create inventory entry
                const existingInventory = await tx
                    .select()
                    .from(inventory)
                    .where(and(eq(inventory.userId, userId), eq(inventory.itemId, shopItem.item.id)))
                    .limit(1);

                let inventoryItem: Inventory;
                if (existingInventory.length > 0) {
                    // Update existing inventory
                    const updated = await tx
                        .update(inventory)
                        .set({
                            count: sql`${inventory.count} + ${quantity}`,
                            updatedAt: new Date(),
                        })
                        .where(eq(inventory.id, existingInventory[0].id))
                        .returning();

                    inventoryItem = updated[0];
                } else {
                    // Create new inventory entry
                    const newInventory: InventoryInsert = {
                        userId: userId,
                        itemId: shopItem.item.id,
                        count: quantity,
                    };

                    const created = await tx.insert(inventory).values(newInventory).returning();
                    inventoryItem = created[0];
                }

                return {
                    purchases: purchaseResults,
                    inventory: inventoryItem,
                };
            });

            Logger.info(`[ShopService] User ${userId} purchased ${quantity} x ${shopItem.item.name} for ${totalCost} coins`);

            return {
                purchases: result.purchases,
                inventory: result.inventory,
            };
        } catch (error) {
            Logger.error(`[ShopService] Failed to purchase item for user ${userId}:`, error);
            throw error; // Rethrow to preserve error message
        }
    }

    /**
     * Add item to user's inventory
     * @param userId - The user UUID
     * @param itemId - The item UUID
     * @param count - Number of items to add
     * @returns The updated inventory record
     */
    public async addToInventory(userId: string, itemId: string, count: number = 1): Promise<Inventory> {
        const db = getDb();

        try {
            // Check if user already has this item
            const existingInventory = await db
                .select()
                .from(inventory)
                .where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId)))
                .limit(1);

            if (existingInventory.length > 0) {
                // Update existing inventory
                const updated = await db
                    .update(inventory)
                    .set({
                        count: sql`${inventory.count} + ${count}`,
                        updatedAt: new Date(),
                    })
                    .where(eq(inventory.id, existingInventory[0].id))
                    .returning();

                return updated[0];
            } else {
                // Create new inventory entry
                const newInventory: InventoryInsert = {
                    userId: userId,
                    itemId: itemId,
                    count: count,
                };

                const created = await db.insert(inventory).values(newInventory).returning();

                return created[0];
            }
        } catch (error) {
            Logger.error(`[ShopService] Failed to add to inventory for user ${userId}:`, error);
            throw new Error(`Failed to add to inventory: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get user's inventory
     * @param userId - The user UUID
     * @returns Array of inventory items with item details
     */
    public async getUserInventory(userId: string): Promise<
        Array<{
            inventory: Inventory;
            item: Item;
        }>
    > {
        const db = getDb();

        try {
            const result = await db
                .select({
                    inventory: inventory,
                    item: items,
                })
                .from(inventory)
                .innerJoin(items, eq(inventory.itemId, items.id))
                .where(eq(inventory.userId, userId));

            return result;
        } catch (error) {
            Logger.error(`[ShopService] Failed to get inventory for user ${userId}:`, error);
            throw new Error(`Failed to get inventory: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a specific inventory item
     * @param userId - The user UUID
     * @param itemId - The item UUID
     * @returns Inventory item with details, or null if not found
     */
    public async getInventoryItem(userId: string, itemId: string): Promise<{
        inventory: Inventory;
        item: Item;
    } | null> {
        const db = getDb();

        try {
            const result = await db
                .select({
                    inventory: inventory,
                    item: items,
                })
                .from(inventory)
                .innerJoin(items, eq(inventory.itemId, items.id))
                .where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId)))
                .limit(1);

            return result[0] || null;
        } catch (error) {
            Logger.error(`[ShopService] Failed to get inventory item for user ${userId}:`, error);
            throw new Error(`Failed to get inventory item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Remove item from user's inventory
     * @param userId - The user UUID
     * @param itemId - The item UUID
     * @param count - Number of items to remove
     * @returns The updated inventory record, or null if item was completely removed
     * @throws Error if user doesn't have enough items
     */
    public async removeFromInventory(userId: string, itemId: string, count: number = 1): Promise<Inventory | null> {
        const db = getDb();

        try {
            const inventoryItem = await this.getInventoryItem(userId, itemId);

            if (!inventoryItem) {
                throw new Error('Item not in inventory');
            }

            if (inventoryItem.inventory.count < count) {
                throw new Error(`Not enough items. Have ${inventoryItem.inventory.count}, trying to remove ${count}`);
            }

            const newCount = inventoryItem.inventory.count - count;

            if (newCount === 0) {
                // Remove inventory entry completely
                await db.delete(inventory).where(eq(inventory.id, inventoryItem.inventory.id));

                return null;
            } else {
                // Update count
                const updated = await db
                    .update(inventory)
                    .set({
                        count: newCount,
                        updatedAt: new Date(),
                    })
                    .where(eq(inventory.id, inventoryItem.inventory.id))
                    .returning();

                return updated[0];
            }
        } catch (error) {
            Logger.error(`[ShopService] Failed to remove from inventory for user ${userId}:`, error);
            throw error; // Rethrow to preserve error message
        }
    }

    /**
     * Get user's purchase history
     * @param userId - The user UUID
     * @param limit - Maximum number of purchases to return
     * @returns Array of purchases with item details
     */
    public async getPurchaseHistory(
        userId: string,
        limit: number = 10,
    ): Promise<
        Array<{
            purchase: PurchaseInsert;
            item: Item;
            shop: Shop;
        }>
    > {
        const db = getDb();

        try {
            const result = await db
                .select({
                    purchase: purchases,
                    item: items,
                    shop: shop,
                })
                .from(purchases)
                .innerJoin(items, eq(purchases.itemId, items.id))
                .innerJoin(shop, eq(purchases.shopId, shop.id))
                .where(eq(purchases.userId, userId))
                .orderBy(sql`${purchases.createdAt} DESC`)
                .limit(limit);

            return result;
        } catch (error) {
            Logger.error(`[ShopService] Failed to get purchase history for user ${userId}:`, error);
            throw new Error(`Failed to get purchase history: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Execute a purchase and send the response to the user
     * This method handles the entire purchase flow including UI responses
     * @param intr - The interaction (command or modal)
     * @param userId - The user UUID
     * @param userTag - The user's Discord tag (for logging)
     * @param identifier - The shop entry UUID or slug
     * @param quantity - Number of items to purchase
     * @param isEphemeral - Whether the response should be ephemeral (default: false for commands, true for modals)
     */
    public async executePurchaseWithResponse(
        intr: ChatInputCommandInteraction | ModalSubmitInteraction,
        userId: string,
        userTag: string,
        identifier: string,
        quantity: number,
        isEphemeral: boolean = false,
    ): Promise<void> {
        try {
            // Validate quantity
            if (quantity < 1) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Quantity must be at least 1.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed, isEphemeral);
                return;
            }

            if (quantity > ShopLimits.MAX_PURCHASE_QUANTITY) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`Maximum quantity is ${ShopLimits.MAX_PURCHASE_QUANTITY}.`)
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed, isEphemeral);
                return;
            }

            // Get shop item details
            const shopItem = await this.getShopItemByIdOrSlug(identifier);

            if (!shopItem) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Shop item not found. Please check the item ID or slug and try again.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed, isEphemeral);
                return;
            }

            // Get user to check initial balance
            const user = await this.userService.getUserById(userId);

            if (!user) {
                Logger.error(`[ShopService] User not found: ${userId}`);
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Failed to retrieve your user data.')
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed, isEphemeral);
                return;
            }

            // Attempt to purchase
            try {
                const result = await this.purchaseItem(userId, identifier, quantity);

                // Get updated user balance
                const updatedUser = await this.userService.getUserById(userId);

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

                await InteractionUtils.send(intr, embed, isEphemeral);

                Logger.info(`[ShopService] ${userTag} purchased ${quantity} x ${shopItem.item.name} for ${totalCost} coins`);
            } catch (purchaseError) {
                // Handle specific purchase errors (insufficient funds, etc.)
                const errorMessage =
                    purchaseError instanceof Error ? purchaseError.message : 'An unknown error occurred';

                const embed = new EmbedBuilder()
                    .setTitle('❌ Purchase Failed')
                    .setDescription(errorMessage)
                    .addFields({ name: 'Your Balance', value: `${user.money} coins`, inline: true })
                    .setColor(0xff0000);

                await InteractionUtils.send(intr, embed, isEphemeral);
            }
        } catch (error) {
            Logger.error(`[ShopService] Error executing purchase for user ${userTag}:`, error);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while processing your purchase. Please try again later.')
                .setColor(0xff0000);

            await InteractionUtils.send(intr, errorEmbed, isEphemeral);
        }
    }
}
