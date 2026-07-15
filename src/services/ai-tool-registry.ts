import { eq, ilike, sql } from 'drizzle-orm';
import OpenAI from 'openai';

import { ChannelContextService } from './channel-context.service.js';
import { getDb } from './database.service.js';
import { FishingCooldownService } from './fishing-cooldown.service.js';
import { FishingService } from './fishing.service.js';
import { ProactivePreferencesService } from './proactive-preferences.service.js';
import { ShopService } from './shop.service.js';
import { UserService } from './user.service.js';
import { ShopLimits } from '../constants/shop-limits.js';
import { catchables, catches } from '../db/schema.js';

export type AIToolContext = {
	userSnowflake: string;
	guildSnowflake: string | null;
	username: string;
	channelId: string;
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
		const timeoutMs = tool.timeoutMs ?? 10000;
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new Error(`${name} timed out`)), timeoutMs);
		});
		try {
			return JSON.stringify(await Promise.race([tool.handler(arguments_, context), timeout]));
		} finally {
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
	const cooldowns = new FishingCooldownService();
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
			const user = await currentUser(context);
			const cooldown = await cooldowns.checkCooldown(user.id, context.guildSnowflake);
			if (!cooldown.allowed) {
				return { success: false, reason: 'cooldown', ...cooldown };
			}
			const rarity = await fishing.determineRarity(user.id);
			const caught = await fishing.pickCatchableByRarity(rarity);
			if (!caught) { return { success: false, reason: 'no_catchable' }; }
			const worth = await fishing.calculateFinalWorth(caught.worth, user.id);
			await users.addMoney(user.id, worth);
			const catchRecord = await fishing.addCatch(user.id, caught.id);
			await cooldowns.recordAttempt(user.id, context.guildSnowflake);
			if (caught.rarity >= 2) {
				await proactive.enqueueRareCatchAlerts({
					guildSnowflake: context.guildSnowflake,
					catcherSnowflake: context.userSnowflake,
					catchableName: caught.name,
					rarityName: fishing.getRarityName(caught.rarity),
					eventKey: catchRecord.id ?? `${user.id}:${caught.id}:${Date.now()}`,
				});
			}
			return { success: true, catch: caught, worth, balance: user.money + worth };
		},
	});
	registry.register({
		definition: functionTool('buy_item', 'Purchase a shop item for the current Discord user. Only execute after explicit confirmation.', {
			identifier: { type: 'string' }, quantity: { type: 'number', minimum: 1, maximum: ShopLimits.MAX_PURCHASE_QUANTITY }, confirmed: { type: 'boolean' },
		}, ['identifier', 'quantity', 'confirmed']),
		handler: async (arguments_, context) => {
			const identifier = String(arguments_.identifier);
			const quantity = Math.min(ShopLimits.MAX_PURCHASE_QUANTITY, Math.max(1, Number(arguments_.quantity)));
			const item = await shop.getShopItemByIdOrSlug(identifier);
			if (!item) { return { success: false, reason: 'not_found' }; }
			if (arguments_.confirmed !== true) {
				return { success: false, confirmationRequired: true, item: item.item.name, quantity, totalCost: item.shop.cost * quantity };
			}
			const user = await currentUser(context);
			await shop.purchaseItem(user.id, identifier, quantity);
			return { success: true, item: item.item.name, quantity, totalCost: item.shop.cost * quantity };
		},
	});
	registry.register({
		definition: functionTool('equip_item', 'Activate an owned passive item for the current Discord user.', {
			item_id: { type: 'string' },
		}, ['item_id']),
		handler: async (arguments_, context) => {
			const user = await currentUser(context);
			const owned = await shop.getInventoryItem(user.id, String(arguments_.item_id));
			if (!owned) { return { success: false, reason: 'not_owned' }; }
			if (!owned.item.isPassive) { return { success: false, reason: 'not_passive' }; }
			return { success: true, item: owned.item.name, alreadyActive: true };
		},
	});

	return registry;
}
