import { integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { type } from 'node:os';

export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    discordSnowflake: varchar('discord_snowflake', { length: 255 }).unique().notNull(),
    money: integer('money').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = {
    id: string;
    discordSnowflake: string;
    money: number;
    createdAt: Date;
    updatedAt: Date;
};

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

export type Catachable = {
    id: string;
    name: string;
    rarity: number;
    worth: number;
    image: string;
    firstCaughtBy: string;
    createdAt: Date;
    updatedAt: Date;
};

export const catches = pgTable('catches', {
    id: uuid('id').defaultRandom().primaryKey(),
    catchableId: uuid('catchable_id').references(() => catchables.id),
    caughtBy: uuid('caught_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Catch = {
    id: string;
    catchableId: string;
    caughtBy: string;
    createdAt: Date;
    updatedAt: Date;
};
