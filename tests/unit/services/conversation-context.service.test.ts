import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

vi.mock('../../../src/services/logger.js', () => {
	return { Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});

import { ConversationContextService } from '../../../src/services/conversation-context.service.js';

describe('ConversationContextService keys', () => {
	it('isolates users in the same guild channel', () => {
		const first = ConversationContextService.privateKey({
			guildSnowflake: 'guild', channelSnowflake: 'channel', userSnowflake: 'alice',
		});
		const second = ConversationContextService.privateKey({
			guildSnowflake: 'guild', channelSnowflake: 'channel', userSnowflake: 'bob',
		});
		expect(first).not.toBe(second);
	});

	it('isolates the same user across guilds and DMs', () => {
		const guild = ConversationContextService.privateKey({
			guildSnowflake: 'guild', channelSnowflake: 'channel', userSnowflake: 'alice',
		});
		const direct = ConversationContextService.privateKey({
			guildSnowflake: null, channelSnowflake: 'channel', userSnowflake: 'alice',
		});
		expect(guild).not.toBe(direct);
	});

	it('keeps public channel keys separate from private chains', () => {
		expect(ConversationContextService.publicKey('guild', 'channel'))
			.not.toBe(ConversationContextService.privateKey({
				guildSnowflake: 'guild', channelSnowflake: 'channel', userSnowflake: 'alice',
			}));
	});
});
