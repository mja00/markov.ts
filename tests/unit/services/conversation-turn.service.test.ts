import { describe, expect, it } from 'vitest';

import { ConversationTurnService } from '../../../src/services/conversation-turn.service.js';

describe('ConversationTurnService', () => {
	it('offers the next turn to the same user', () => {
		const service = new ConversationTurnService();

		service.open('channel-1', 'user-1');

		expect(service.consume('channel-1', 'user-1')).toBe(true);
		expect(service.consume('channel-1', 'user-1')).toBe(false);
	});

	it('does not let another user claim or close a turn', () => {
		const service = new ConversationTurnService();

		service.open('channel-1', 'user-1');

		expect(service.consume('channel-1', 'user-2')).toBe(false);
		expect(service.consume('channel-1', 'user-1')).toBe(true);
	});

	it('keeps concurrent user turns open in the same channel', () => {
		const service = new ConversationTurnService();

		service.open('channel-1', 'user-1');
		service.open('channel-1', 'user-2');

		expect(service.consume('channel-1', 'user-1')).toBe(true);
		expect(service.consume('channel-1', 'user-2')).toBe(true);
	});

	it('expires an unused turn', () => {
		let now = 1000;
		const service = new ConversationTurnService({ windowMs: 500, now: () => now });

		service.open('channel-1', 'user-1');
		now = 1501;

		expect(service.consume('channel-1', 'user-1')).toBe(false);
	});

	it('keeps turns isolated by channel', () => {
		const service = new ConversationTurnService();

		service.open('channel-1', 'user-1');

		expect(service.consume('channel-2', 'user-1')).toBe(false);
		expect(service.consume('channel-1', 'user-1')).toBe(true);
	});

	it('can be disabled', () => {
		const service = new ConversationTurnService({ enabled: false });

		service.open('channel-1', 'user-1');

		expect(service.consume('channel-1', 'user-1')).toBe(false);
	});
});
