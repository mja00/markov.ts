import { describe, expect, it } from 'vitest';

import { AIToolRegistry } from '../../../src/services/ai-tool-registry.js';

describe('AIToolRegistry', () => {
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
});
