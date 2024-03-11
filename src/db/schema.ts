import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { boolean, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    discordSnowflake: varchar('discord_snowflake', { length: 255 }).unique().notNull(),
    discordTag: varchar('discord_tag', { length: 255 }),
    money: integer('money').default(0).notNull(),
    autoFishing: boolean('auto_fishing').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = InferSelectModel<typeof users>;
export type UserInsert = InferInsertModel<typeof users>;

export const catchables = pgTable('catchables', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    rarity: integer('rarity').default(0).notNull(),
    worth: integer('worth').default(0).notNull(),
    image: varchar('image', { length: 255 }),
    firstCaughtBy: uuid('first_caught_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Catchable = InferSelectModel<typeof catchables>;
export type CatchableInsert = InferInsertModel<typeof catchables>;

export const catches = pgTable('catches', {
    id: uuid('id').defaultRandom().primaryKey(),
    catchableId: uuid('catchable_id').references(() => catchables.id),
    caughtBy: uuid('caught_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Catch = InferSelectModel<typeof catches>;
export type CatchInsert = InferInsertModel<typeof catches>;

export const items = pgTable('items', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    image: varchar('image', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Item = InferSelectModel<typeof items>;
export type ItemInsert = InferInsertModel<typeof items>;

export const shop = pgTable('shop', {
    id: uuid('id').defaultRandom().primaryKey(),
    itemId: uuid('item_id').references(() => items.id),
    cost: integer('cost').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Shop = InferSelectModel<typeof shop>;
export type ShopInsert = InferInsertModel<typeof shop>;

export const purchases = pgTable('purchases', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    itemId: uuid('item_id').references(() => items.id),
    shopId: uuid('shop_id').references(() => shop.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Purchase = InferSelectModel<typeof purchases>;
export type PurchaseInsert = InferInsertModel<typeof purchases>;

export const inventory = pgTable('inventory', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    itemId: uuid('item_id').references(() => items.id),
    count: integer('count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Inventory = InferSelectModel<typeof inventory>;
export type InventoryInsert = InferInsertModel<typeof inventory>;
