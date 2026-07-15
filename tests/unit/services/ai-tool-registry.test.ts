import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

const {
	calculateWorthMock,
	checkCooldownMock,
	determineRarityMock,
	ensureUserMock,
	getRarityNameMock,
	getInventoryItemMock,
	getShopItemMock,
	pickCatchableMock,
	purchaseItemMock,
	transactionMock,
} = vi.hoisted(() => {
	return {
		calculateWorthMock: vi.fn(),
		checkCooldownMock: vi.fn(),
		determineRarityMock: vi.fn(),
		ensureUserMock: vi.fn(),
		getRarityNameMock: vi.fn(),
		getInventoryItemMock: vi.fn(),
		getShopItemMock: vi.fn(),
		pickCatchableMock: vi.fn(),
		purchaseItemMock: vi.fn(),
		transactionMock: vi.fn(),
	};
});

vi.mock('../../../src/services/logger.js', () => {
	return { Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});
vi.mock('../../../src/services/shop.service.js', () => {
	return {
		ShopService: class {
			public getInventoryItem = getInventoryItemMock;
			public getShopItemByIdOrSlug = getShopItemMock;
			public purchaseItem = purchaseItemMock;
		},
	};
});
vi.mock('../../../src/services/user.service.js', () => {
	return {
		UserService: class {
			public ensureUserExists = ensureUserMock;
		},
	};
});
vi.mock('../../../src/services/fishing-cooldown.service.js', () => {
	return {
		FishingCooldownService: class {
			public checkCooldown = checkCooldownMock;
		},
	};
});
vi.mock('../../../src/services/fishing.service.js', () => {
	return {
		FishingService: class {
			public calculateFinalWorth = calculateWorthMock;
			public determineRarity = determineRarityMock;
			public getRarityName = getRarityNameMock;
			public pickCatchableByRarity = pickCatchableMock;
		},
	};
});
vi.mock('../../../src/services/database.service.js', () => {
	return { getDb: () => { return { transaction: transactionMock }; } };
});

import { AIToolRegistry, createDomainToolRegistry } from '../../../src/services/ai-tool-registry.js';

describe('AIToolRegistry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('dispatches typed tools with the trusted request context', async () => {
		const registry = new AIToolRegistry();
		registry.register({
			definition: {
				type: 'function',
				name: 'who_am_i',
				description: 'test',
				strict: true,
				parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
			},
			handler: async (_arguments, context) => { return { user: context.userSnowflake }; },
		});
		await expect(registry.execute('who_am_i', { user: 'attacker' }, {
			userSnowflake: 'trusted', guildSnowflake: 'guild', username: 'Alice', channelId: 'channel',
		})).resolves.toBe('{"user":"trusted"}');
	});

	it('rejects unknown tools', async () => {
		const registry = new AIToolRegistry();
		await expect(registry.execute('missing', {}, {
			userSnowflake: 'trusted', guildSnowflake: null, username: 'Alice', channelId: 'dm',
		})).rejects.toThrow('Unknown AI tool');
	});

	it('aborts handlers that exceed their timeout', async () => {
		const registry = new AIToolRegistry();
		registry.register({
			definition: {
				type: 'function',
				name: 'slow',
				description: 'test',
				strict: true,
				parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
			},
			timeoutMs: 1,
			handler: async (_arguments, context) => {
				await new Promise((resolve) => {
					setTimeout(resolve, 20);
				});
				context.signal?.throwIfAborted();
				return { success: true };
			},
		});

		await expect(registry.execute('slow', {}, {
			userSnowflake: 'trusted', guildSnowflake: null, username: 'Alice', channelId: 'dm',
		})).rejects.toThrow('slow timed out');
	});

	it('never authorizes a purchase from model-controlled confirmation data', async () => {
		getShopItemMock.mockResolvedValue({ item: { name: 'Lucky Rod' }, shop: { cost: 25 } });
		const registry = createDomainToolRegistry();

		const result = JSON.parse(await registry.execute('buy_item', {
			identifier: 'lucky-rod', quantity: 2, confirmed: true,
		}, {
			userSnowflake: 'trusted', guildSnowflake: 'guild', username: 'Alice', channelId: 'channel',
		}));

		expect(result).toMatchObject({ success: false, confirmationRequired: true, totalCost: 50 });
		expect(purchaseItemMock).not.toHaveBeenCalled();
	});

	it('reports owned passive items as automatically active', async () => {
		ensureUserMock.mockResolvedValue({ id: 'user-id' });
		getInventoryItemMock.mockResolvedValue({
			inventory: { id: 'inventory-id' },
			item: { name: 'Lucky Rod', isPassive: true },
		});
		const registry = createDomainToolRegistry();

		const result = JSON.parse(await registry.execute('equip_item', { item_id: 'item-id' }, {
			userSnowflake: 'trusted', guildSnowflake: 'guild', username: 'Alice', channelId: 'channel',
		}));

		expect(result).toMatchObject({ success: true, active: true, activationRequired: false });
	});

	it('keeps fishing mutations in one transaction when the cooldown write fails', async () => {
		ensureUserMock.mockResolvedValue({ id: 'user-id', money: 10 });
		checkCooldownMock.mockResolvedValue({ allowed: true });
		determineRarityMock.mockResolvedValue(2);
		pickCatchableMock.mockResolvedValue({ id: 'fish-id', name: 'Rare Fish', rarity: 2, worth: 20 });
		calculateWorthMock.mockResolvedValue(20);
		let insertCount = 0;
		transactionMock.mockImplementation(async (callback) => {
			const tx = {
				select: vi.fn(() => {
					return { from: () => { return { where: () => { return { limit: async () => [{ id: 'guild-id' }] }; } }; } };
				}),
				update: vi.fn(() => {
					return { set: () => { return { where: () => { return { returning: async () => [{ id: 'user-id', money: 30 }] }; } }; } };
				}),
				insert: vi.fn(() => {
					insertCount++;
					if (insertCount === 1) {
						return { values: () => { return { returning: async () => [{ id: 'catch-id' }] }; } };
					}
					return { values: async () => { throw new Error('cooldown write failed'); } };
				}),
			};
			return callback(tx);
		});
		const registry = createDomainToolRegistry();

		await expect(registry.execute('fish', {}, {
			userSnowflake: 'trusted', guildSnowflake: 'guild', username: 'Alice', channelId: 'channel',
		})).rejects.toThrow('cooldown write failed');
		expect(transactionMock).toHaveBeenCalledTimes(1);
	});
});
