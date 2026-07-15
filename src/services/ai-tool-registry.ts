import {
	and,
	asc,
	eq,
	gte,
	ilike,
	isNull,
	sql,
} from 'drizzle-orm';
import OpenAI from 'openai';

import { ChannelContextService } from './channel-context.service.js';
import { getDb } from './database.service.js';
import { FishingService } from './fishing.service.js';
import { DEFAULT_FISHING_COOLDOWN_LIMIT, DEFAULT_FISHING_COOLDOWN_WINDOW_SECONDS } from './guild.service.js';
import { Logger } from './logger.js';
import { ProactivePreferencesService } from './proactive-preferences.service.js';
import { ShopService } from './shop.service.js';
import { UserService } from './user.service.js';
import { ShopLimits } from '../constants/shop-limits.js';
import {
	catchables,
	catches,
	fishingAttempts,
	guilds,
	users as usersTable,
} from '../db/schema.js';

export type AIToolContext = {
	userSnowflake: string;
	guildSnowflake: string | null;
	username: string;
	channelId: string;
	signal?: AbortSignal;
};

type ToolHandler = (arguments_: Record<string, unknown>, context: AIToolContext) => Promise<unknown>;

export type RegisteredTool = {
	definition: OpenAI.Responses.FunctionTool;
	handler: ToolHandler;
	timeoutMs?: number;
};

export class AIToolRegistry {
	private readonly tools = new Map<string, RegisteredTool>();

	public register(tool: RegisteredTool): void {
		if (this.tools.has(tool.definition.name)) {
			throw new Error(`AI tool already registered: ${tool.definition.name}`);
		}
		this.tools.set(tool.definition.name, tool);
	}

	public definitions(): OpenAI.Responses.Tool[] {
		return [...this.tools.values()].map(tool => tool.definition);
	}

	public has(name: string): boolean {
		return this.tools.has(name);
	}

	public async execute(name: string, arguments_: Record<string, unknown>, context: AIToolContext): Promise<string> {
		const tool = this.tools.get(name);
		if (!tool) {
			throw new Error(`Unknown AI tool: ${name}`);
		}
		context.signal?.throwIfAborted();
		const timeoutMs = tool.timeoutMs ?? 10000;
		const controller = new AbortController();
		const upstreamSignal = context.signal;
		const abortFromUpstream = () => {
			controller.abort(upstreamSignal?.reason);
		};
		if (upstreamSignal?.aborted) {
			abortFromUpstream();
		} else {
			upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
		}
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				controller.abort();
				reject(new Error(`${name} timed out`));
			}, timeoutMs);
		});
		try {
			return JSON.stringify(await Promise.race([
				tool.handler(arguments_, { ...context, signal: controller.signal }),
				timeout,
			]));
		} finally {
			upstreamSignal?.removeEventListener('abort', abortFromUpstream);
			if (timer) {
				clearTimeout(timer);
			}
		}
	}
}

const functionTool = (
	name: string,
	description: string,
	properties: Record<string, unknown> = {},
	required: string[] = [],
): OpenAI.Responses.FunctionTool => {
	return {
		type: 'function',
		name,
		description,
		strict: true,
		parameters: { type: 'object', properties, required, additionalProperties: false },
	};
};

export function createDomainToolRegistry(): AIToolRegistry {
	const registry = new AIToolRegistry();
	const users = new UserService();
	const fishing = new FishingService();
	const shop = new ShopService();
	const channels = new ChannelContextService();
	const proactive = new ProactivePreferencesService();
	const currentUser = async (context: AIToolContext) => users.ensureUserExists(context.userSnowflake, context.username);

	registry.register({
		definition: functionTool('search_recent_context', 'Search retained public messages and summaries from this Discord channel.', {
			query: { type: 'string' },
		}, ['query']),
		handler: async (arguments_, context) => (context.guildSnowflake
			? channels.search(context.guildSnowflake, context.channelId, String(arguments_.query))
			: { unavailable: true, reason: 'Private conversations are not stored as public channel context.' }),
	});
	registry.register({
		definition: functionTool('get_fishing_stats', 'Get fishing statistics and balance for the current Discord user.'),
		handler: async (_arguments, context) => {
			const user = await currentUser(context);
			return { balance: user.money, autoFishing: user.autoFishing, ...await users.getUserStats(user.id) };
		},
	});
	registry.register({
		definition: functionTool('get_inventory', 'Get the current Discord user’s inventory and item effects.'),
		handler: async (_arguments, context) => {
			const user = await currentUser(context);
			return { balance: user.money, items: await shop.getUserInventory(user.id) };
		},
	});
	registry.register({
		definition: functionTool('get_shop', 'List items currently available in the fishing shop.'),
		handler: async () => shop.getShopItems(),
	});
	registry.register({
		definition: functionTool('get_collection_progress', 'Get unique catchable collection progress for the current Discord user.'),
		handler: async (_arguments, context) => {
			const user = await currentUser(context);
			const db = getDb();
			const [owned] = await db.select({ count: sql<number>`count(distinct ${catches.catchableId})::int` })
				.from(catches).where(eq(catches.caughtBy, user.id));
			const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(catchables);
			return { caught: owned?.count ?? 0, total: total?.count ?? 0 };
		},
	});
	registry.register({
		definition: functionTool('search_catchables', 'Search catchable fish by name.', {
			query: { type: 'string' }, limit: { type: 'number', minimum: 1, maximum: 20 },
		}, ['query', 'limit']),
		handler: async arguments_ => getDb().select().from(catchables)
			.where(ilike(catchables.name, `%${String(arguments_.query)}%`))
			.limit(Math.min(20, Math.max(1, Number(arguments_.limit)))),
	});
	registry.register({
		definition: functionTool('get_leaderboard', 'Get fishing leaderboards.', {
			metric: { type: 'string', enum: ['money', 'catches'] },
		}, ['metric']),
		handler: async arguments_ => (arguments_.metric === 'money'
			? users.getTopUsersByMoney(10)
			: users.getTopUsersByCatches(10)),
	});
	registry.register({
		definition: functionTool('fish', 'Fish once as the current Discord user. Cooldowns and item effects are enforced.'),
		handler: async (_arguments, context) => {
			context.signal?.throwIfAborted();
			const user = await currentUser(context);
			const rarity = await fishing.determineRarity(user.id);
			context.signal?.throwIfAborted();
			const caught = await fishing.pickCatchableByRarity(rarity);
			if (!caught) { return { success: false, reason: 'no_catchable' }; }
			const worth = await fishing.calculateFinalWorth(caught.worth, user.id);
			context.signal?.throwIfAborted();
			const outcome = await getDb().transaction(async (tx) => {
				context.signal?.throwIfAborted();
				const lockKey = `fish:${user.id}:${context.guildSnowflake ?? 'dm'}`;
				await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
				context.signal?.throwIfAborted();
				if (context.guildSnowflake) {
					await tx.insert(guilds).values({ discordSnowflake: context.guildSnowflake })
						.onConflictDoNothing({ target: guilds.discordSnowflake });
				}
				const guildRows = context.guildSnowflake
					? await tx.select({
						id: guilds.id,
						fishingCooldownLimit: guilds.fishingCooldownLimit,
						fishingCooldownWindowSeconds: guilds.fishingCooldownWindowSeconds,
					}).from(guilds)
						.where(eq(guilds.discordSnowflake, context.guildSnowflake))
						.limit(1)
					: [];
				const guild = guildRows[0];
				if (context.guildSnowflake && !guild) {
					throw new Error(`Guild ${context.guildSnowflake} not found`);
				}
				const limit = guild?.fishingCooldownLimit ?? DEFAULT_FISHING_COOLDOWN_LIMIT;
				const windowSeconds = guild?.fishingCooldownWindowSeconds ?? DEFAULT_FISHING_COOLDOWN_WINDOW_SECONDS;
				const cutoff = new Date(Date.now() - (windowSeconds * 1000));
				const scope = guild
					? eq(fishingAttempts.guildId, guild.id)
					: isNull(fishingAttempts.guildId);
				const attemptFilter = and(
					eq(fishingAttempts.userId, user.id),
					gte(fishingAttempts.attemptedAt, cutoff),
					scope,
				);
				const attemptCounts = await tx.select({ count: sql<number>`count(*)::int` })
					.from(fishingAttempts)
					.where(attemptFilter);
				const attemptCount = attemptCounts[0]?.count ?? 0;
				if (attemptCount >= limit) {
					const oldestAttempts = await tx.select({ attemptedAt: fishingAttempts.attemptedAt })
						.from(fishingAttempts)
						.where(attemptFilter)
						.orderBy(asc(fishingAttempts.attemptedAt))
						.limit(1);
					const oldest = oldestAttempts[0]?.attemptedAt;
					return {
						success: false as const,
						cooldown: {
							remainingAttempts: 0,
							timeUntilNextAttempt: oldest
								? Math.max(0, Math.ceil((oldest.getTime() + (windowSeconds * 1000) - Date.now()) / 1000))
								: windowSeconds,
							limit,
							windowSeconds,
						},
					};
				}
				context.signal?.throwIfAborted();
				await tx.insert(fishingAttempts).values({
					userId: user.id,
					guildId: guild?.id ?? null,
					attemptedAt: new Date(),
				});
				context.signal?.throwIfAborted();
				const updatedUsers = await tx.update(usersTable).set({
					money: sql`${usersTable.money} + ${worth}`,
					updatedAt: new Date(),
				})
					.where(eq(usersTable.id, user.id))
					.returning();
				context.signal?.throwIfAborted();
				if (!updatedUsers[0]) { throw new Error(`User ${user.id} not found`); }
				const catchRecords = await tx.insert(catches).values({
					caughtBy: user.id,
					catchableId: caught.id,
				}).returning();
				context.signal?.throwIfAborted();
				if (!catchRecords[0]) { throw new Error('Failed to record catch'); }
				return { success: true as const, user: updatedUsers[0], catchRecord: catchRecords[0] };
			});
			if (!outcome.success) {
				return { success: false, reason: 'cooldown', ...outcome.cooldown };
			}
			if (caught.rarity >= 2) {
				void proactive.enqueueRareCatchAlerts({
					guildSnowflake: context.guildSnowflake,
					catcherSnowflake: context.userSnowflake,
					catchableName: caught.name,
					rarityName: fishing.getRarityName(caught.rarity),
					eventKey: outcome.catchRecord.id ?? `${user.id}:${caught.id}:${Date.now()}`,
				}).catch((error) => {
					Logger.warn('[AIToolRegistry] Failed to enqueue rare catch alerts:', error);
				});
			}
			return { success: true, catch: caught, worth, balance: outcome.user.money };
		},
	});
	registry.register({
		definition: functionTool('buy_item', 'Preview a shop purchase that requires user confirmation outside the model.', {
			identifier: { type: 'string' }, quantity: { type: 'number', minimum: 1, maximum: ShopLimits.MAX_PURCHASE_QUANTITY },
		}, ['identifier', 'quantity']),
		handler: async (arguments_) => {
			const identifier = String(arguments_.identifier);
			const quantity = Math.min(ShopLimits.MAX_PURCHASE_QUANTITY, Math.max(1, Number(arguments_.quantity)));
			const item = await shop.getShopItemByIdOrSlug(identifier);
			if (!item) { return { success: false, reason: 'not_found' }; }
			return {
				success: false,
				confirmationRequired: true,
				item: item.item.name,
				quantity,
				totalCost: item.shop.cost * quantity,
				reason: 'Purchases require a server-verified user confirmation.',
			};
		},
	});
	registry.register({
		definition: functionTool('equip_item', 'Verify that an owned passive item is active automatically.', {
			item_id: { type: 'string' },
		}, ['item_id']),
		handler: async (arguments_, context) => {
			const user = await currentUser(context);
			const owned = await shop.getInventoryItem(user.id, String(arguments_.item_id));
			if (!owned) { return { success: false, reason: 'not_owned' }; }
			if (!owned.item.isPassive) { return { success: false, reason: 'not_passive' }; }
			return { success: true, item: owned.item.name, active: true, activationRequired: false };
		},
	});

	return registry;
}
