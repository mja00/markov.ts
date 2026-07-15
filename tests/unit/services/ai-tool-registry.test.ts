import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

const {
	calculateWorthMock,
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

	it('propagates caller cancellation to the handler signal', async () => {
		const registry = new AIToolRegistry();
		const controller = new AbortController();
		let observedAbort = false;
		registry.register({
			definition: {
				type: 'function',
				name: 'cancelled',
				description: 'test',
				strict: true,
				parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
			},
			handler: async (_arguments, context) => {
				await new Promise<void>((_resolve, reject) => {
					context.signal?.addEventListener('abort', () => {
						observedAbort = true;
						reject(context.signal?.reason);
					}, { once: true });
				});
			},
		});

		const executing = registry.execute('cancelled', {}, {
			userSnowflake: 'trusted', guildSnowflake: null, username: 'Alice', channelId: 'dm', signal: controller.signal,
		});
		await Promise.resolve();
		controller.abort(new Error('caller cancelled'));

		await expect(executing).rejects.toThrow('caller cancelled');
		expect(observedAbort).toBe(true);
	});

	it('rejects an already-aborted caller signal without invoking the handler', async () => {
		const registry = new AIToolRegistry();
		const controller = new AbortController();
		controller.abort(new Error('already cancelled'));
		const handler = vi.fn(async () => { return { success: true }; });
		registry.register({
			definition: {
				type: 'function',
				name: 'pre_cancelled',
				description: 'test',
				strict: true,
				parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
			},
			handler,
		});

		await expect(registry.execute('pre_cancelled', {}, {
			userSnowflake: 'trusted', guildSnowflake: null, username: 'Alice', channelId: 'dm', signal: controller.signal,
		})).rejects.toThrow('already cancelled');
		expect(handler).not.toHaveBeenCalled();
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
		determineRarityMock.mockResolvedValue(2);
		pickCatchableMock.mockResolvedValue({ id: 'fish-id', name: 'Rare Fish', rarity: 2, worth: 20 });
		calculateWorthMock.mockResolvedValue(20);
		const updateMock = vi.fn();
		let insertCount = 0;
		transactionMock.mockImplementation(async (callback) => {
			let selectCount = 0;
			const tx = {
				execute: vi.fn(),
				select: vi.fn(() => {
					selectCount++;
					return {
						from: () => {
							return {
								where: () => {
									const result = selectCount === 1
										? { limit: async () => [{
											id: 'guild-id', fishingCooldownLimit: 10, fishingCooldownWindowSeconds: 3600,
										}] }
										: Promise.resolve([{ count: 0 }]);
									return result;
								},
							};
						},
					};
				}),
				update: updateMock.mockImplementation(() => {
					return { set: () => { return { where: () => { return { returning: async () => [{ id: 'user-id', money: 30 }] }; } }; } };
				}),
				insert: vi.fn(() => {
					insertCount++;
					if (insertCount === 1) {
						return { values: () => { return { onConflictDoNothing: vi.fn() }; } };
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
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('serializes concurrent fishing attempts at the cooldown limit', async () => {
		ensureUserMock.mockResolvedValue({ id: 'user-id', money: 10 });
		determineRarityMock.mockResolvedValue(1);
		pickCatchableMock.mockResolvedValue({ id: 'fish-id', name: 'Fish', rarity: 1, worth: 20 });
		calculateWorthMock.mockResolvedValue(20);
		let attemptCount = 0;
		let transactionCount = 0;
		let executeCount = 0;
		let lockTail = Promise.resolve();
		let releaseExecuteBarrier: (() => void) | undefined;
		const executeBarrier = new Promise<void>((resolve) => {
			releaseExecuteBarrier = resolve;
		});
		const events: string[] = [];
		transactionMock.mockImplementation(async (callback) => {
			const transactionId = ++transactionCount;
			events.push(`begin:${transactionId}`);
			let releaseLock: (() => void) | undefined;
			let hasLock = false;
			try {
				let insertCount = 0;
				let selectCount = 0;
				const tx = {
					execute: vi.fn(async () => {
						events.push(`lock-wait:${transactionId}`);
						const previousLock = lockTail;
						lockTail = new Promise<void>((resolve) => {
							releaseLock = resolve;
						});
						executeCount++;
						if (executeCount === 2) {
							releaseExecuteBarrier?.();
						}
						await executeBarrier;
						await previousLock;
						hasLock = true;
						events.push(`lock-acquired:${transactionId}`);
					}),
					select: vi.fn(() => {
						selectCount++;
						return {
							from: () => {
								return {
									where: () => {
										if (selectCount === 1) {
											return { limit: async () => [{
												id: 'guild-id', fishingCooldownLimit: 1, fishingCooldownWindowSeconds: 3600,
											}] };
										}
										if (selectCount === 2) {
											events.push(`cooldown-read:${transactionId}`);
											return Promise.resolve([{ count: attemptCount }]);
										}
										return {
											orderBy: () => { return { limit: async () => [{ attemptedAt: new Date() }] }; },
										};
									},
								};
							},
						};
					}),
					insert: vi.fn(() => {
						insertCount++;
						if (insertCount === 1) {
							return { values: () => { return { onConflictDoNothing: vi.fn() }; } };
						}
						if (insertCount === 2) {
							return { values: async () => { attemptCount++; } };
						}
						return { values: () => { return { returning: async () => [{ id: 'catch-id' }] }; } };
					}),
					update: vi.fn(() => {
						return { set: () => { return { where: () => { return { returning: async () => [{ id: 'user-id', money: 30 }] }; } }; } };
					}),
				};
				return await callback(tx);
			} finally {
				if (hasLock) {
					events.push(`lock-released:${transactionId}`);
					releaseLock?.();
				}
			}
		});
		const registry = createDomainToolRegistry();

		const results = await Promise.all([
			registry.execute('fish', {}, {
				userSnowflake: 'trusted', guildSnowflake: 'guild', username: 'Alice', channelId: 'channel',
			}),
			registry.execute('fish', {}, {
				userSnowflake: 'trusted', guildSnowflake: 'guild', username: 'Alice', channelId: 'channel',
			}),
		]);
		const parsed = results.map(result => JSON.parse(result));

		expect(parsed.filter(result => result.success)).toHaveLength(1);
		expect(parsed.filter(result => result.reason === 'cooldown')).toHaveLength(1);
		expect(attemptCount).toBe(1);
		expect(events.slice(0, 4)).toEqual(['begin:1', 'lock-wait:1', 'begin:2', 'lock-wait:2']);
		expect(events.indexOf('lock-acquired:1')).toBeLessThan(events.indexOf('cooldown-read:1'));
		expect(events.indexOf('lock-released:1')).toBeLessThan(events.indexOf('lock-acquired:2'));
		expect(events.indexOf('lock-acquired:2')).toBeLessThan(events.indexOf('cooldown-read:2'));
	});
});
