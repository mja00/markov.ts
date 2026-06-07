import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
	vector,
} from 'drizzle-orm/pg-core';

// Enum for item effect types
export const effectTypeEnum = pgEnum('effect_type_enum', ['RARITY_BOOST', 'WORTH_MULTIPLIER']);

// Enum for time of day
export const timeOfDayEnum = pgEnum('time_of_day_enum', ['DAY', 'NIGHT', 'DAWN', 'DUSK', 'ANY']);

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
	timeOfDay: timeOfDayEnum('time_of_day').default('ANY').notNull(),
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
	slug: varchar('slug', { length: 255 }).unique(),
	effectType: effectTypeEnum('effect_type'),
	effectValue: numeric('effect_value', { precision: 10, scale: 2 }),
	isConsumable: boolean('is_consumable').default(false).notNull(),
	isPassive: boolean('is_passive').default(false).notNull(),
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

export const guilds = pgTable('guilds', {
	id: uuid('id').defaultRandom().primaryKey(),
	discordSnowflake: varchar('discord_snowflake', { length: 255 }).unique().notNull(),
	fishingCooldownLimit: integer('fishing_cooldown_limit').default(10).notNull(),
	fishingCooldownWindowSeconds: integer('fishing_cooldown_window_seconds').default(3600).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Guild = InferSelectModel<typeof guilds>;
export type GuildInsert = InferInsertModel<typeof guilds>;

export const fishingAttempts = pgTable('fishing_attempts', {
	id: uuid('id').defaultRandom().primaryKey(),
	userId: uuid('user_id').references(() => users.id).notNull(),
	guildId: uuid('guild_id').references(() => guilds.id),
	attemptedAt: timestamp('attempted_at').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type FishingAttempt = InferSelectModel<typeof fishingAttempts>;
export type FishingAttemptInsert = InferInsertModel<typeof fishingAttempts>;

export const memoryScopeEnum = pgEnum('memory_scope_enum', ['USER', 'SERVER', 'QUOTE']);

export const memories = pgTable('memories', {
	id: uuid('id').defaultRandom().primaryKey(),
	scope: memoryScopeEnum('scope').notNull(),
	userSnowflake: varchar('user_snowflake', { length: 255 }),
	guildSnowflake: varchar('guild_snowflake', { length: 255 }),
	content: text('content').notNull(),
	embedding: vector('embedding', { dimensions: 1536 }),
	sourceChannelSnowflake: varchar('source_channel_snowflake', { length: 255 }),
	createdByModel: boolean('created_by_model').default(true).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
	return {
		guildIdx: index('memories_guild_idx').on(table.guildSnowflake),
		userGuildIdx: index('memories_user_guild_idx').on(table.userSnowflake, table.guildSnowflake),
		embeddingIdx: index('memories_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
	};
});

export type Memory = InferSelectModel<typeof memories>;
export type MemoryInsert = InferInsertModel<typeof memories>;

export const scheduledMessageStatusEnum = pgEnum('scheduled_message_status_enum', [
	'PENDING',
	'SENT',
	'CANCELLED',
	'FAILED',
]);

// Messages Markov chooses to post to a channel at a future time. Persisted (not
// just an in-memory timer) so they survive restarts, and claimed atomically by
// the processing job so they fire exactly once even with multiple shards running.
export const scheduledMessages = pgTable('scheduled_messages', {
	id: uuid('id').defaultRandom().primaryKey(),
	channelSnowflake: varchar('channel_snowflake', { length: 255 }).notNull(),
	guildSnowflake: varchar('guild_snowflake', { length: 255 }),
	createdBySnowflake: varchar('created_by_snowflake', { length: 255 }),
	content: text('content').notNull(),
	scheduledAt: timestamp('scheduled_at').notNull(),
	status: scheduledMessageStatusEnum('status').default('PENDING').notNull(),
	sentAt: timestamp('sent_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
	return {
		// Drives the job's "due and pending" sweep and the per-channel pending list.
		dueIdx: index('scheduled_messages_due_idx').on(table.status, table.scheduledAt),
		channelIdx: index('scheduled_messages_channel_idx').on(table.channelSnowflake, table.status),
	};
});

export type ScheduledMessage = InferSelectModel<typeof scheduledMessages>;
export type ScheduledMessageInsert = InferInsertModel<typeof scheduledMessages>;
