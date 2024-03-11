import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createRequire } from 'node:module';
import postgres from 'postgres';

import { Catachable, catchables, catches, User, users } from '../db/schema.js';
import { Logger } from '../services/logger.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');

const queryClient = postgres(Config.db.connectionString);
const db = drizzle(queryClient);

export function getDb(): ReturnType<typeof drizzle> {
    return db;
}

export async function ensureUserExists(discordId: string, discordTag?: string): Promise<User> {
    let user = (await db
        .select()
        .from(users)
        .where(eq(users.discordSnowflake, discordId))) as User[];
    if (user.length === 0) {
        Logger.info(`Creating user for ${discordId}`);
        const newUser = await db
            .insert(users)
            .values({ discordSnowflake: discordId, discordTag: discordTag })
            .returning();
        return newUser[0];
    }
    // If we get a tag lets update their tag
    if (discordTag && user[0].discordTag !== discordTag) {
        Logger.info(`Updating user tag for ${discordId}`);
        await db.update(users).set({ discordTag: discordTag }).where(eq(users.id, user[0].id));
        user[0].discordTag = discordTag;
    }
    return user[0];
}

export async function pickCatchableByRarity(rarity: number): Promise<any> {
    const catchable = (await db
        .select()
        .from(catchables)
        .where(eq(catchables.rarity, rarity))
        .orderBy(sql`random()`)
        .limit(1)) as Catachable[];
    // Ensure we have a catchable
    if (catchable.length === 0) {
        Logger.error(`No catchable found for rarity: ${rarity}`);
        return null;
    }
    return catchable[0];
}

export async function addWorthToUser(user: User, worth: number): Promise<void> {
    await db
        .update(users)
        .set({ money: user.money + worth })
        .where(eq(users.id, user.id));
}

export async function firstCatch(user: User, catchable: Catachable): Promise<void> {
    await db
        .update(catchables)
        .set({ firstCaughtBy: user.id })
        .where(eq(catchables.id, catchable.id));
}

export async function addCatch(user: User, catchable: Catachable): Promise<void> {
    await db.insert(catches).values({ catchableId: catchable.id, caughtBy: user.id });
}
