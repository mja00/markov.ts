import { and, eq, sql } from 'drizzle-orm';

import { getDb } from './database.service.js';
import { Logger } from './logger.js';
import { UserService } from './user.service.js';
import { Inventory, inventory, InventoryInsert, Item, items, PurchaseInsert, purchases, Shop, shop } from '../db/schema.js';

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
     * Purchase an item from the shop
     * @param userId - The user UUID
     * @param shopId - The shop entry UUID
     * @returns The purchase record and updated inventory
     * @throws Error if user doesn't have enough money or item not found
     */
    public async purchaseItem(
        userId: string,
        shopId: string,
    ): Promise<{
        purchase: PurchaseInsert;
        inventory: Inventory;
    }> {
        const db = getDb();

        try {
            // Get shop item
            const shopItem = await this.getShopItemById(shopId);

            if (!shopItem) {
                throw new Error('Shop item not found');
            }

            // Get user
            const user = await this.userService.getUserById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            // Check if user has enough money
            if (user.money < shopItem.shop.cost) {
                throw new Error(`Insufficient funds. Need ${shopItem.shop.cost} coins, have ${user.money} coins`);
            }

            // Start transaction: subtract money, create purchase, update inventory
            // Subtract money from user
            await this.userService.addMoney(userId, -shopItem.shop.cost);

            // Create purchase record
            const newPurchase: PurchaseInsert = {
                userId: userId,
                itemId: shopItem.item.id,
                shopId: shopId,
            };

            const purchase = await db.insert(purchases).values(newPurchase).returning();

            // Update inventory
            const inventoryItem = await this.addToInventory(userId, shopItem.item.id, 1);

            Logger.info(`[ShopService] User ${userId} purchased item ${shopItem.item.name} for ${shopItem.shop.cost} coins`);

            return {
                purchase: purchase[0],
                inventory: inventoryItem,
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
}
