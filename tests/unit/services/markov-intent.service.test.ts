import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

vi.mock('../../../src/services/logger.js', () => {
	return { Logger: { warn: vi.fn() } };
});

import { MarkovIntentService } from '../../../src/services/markov-intent.service.js';

const input = {
	content: 'Markov, what do you think?',
	botMentioned: false,
	isDirectMessage: false,
	isReplyToMarkov: false,
};

describe('MarkovIntentService', () => {
	it('allows a reply when the intent model classifies the message as about Markov', async () => {
		const classify = vi.fn().mockResolvedValue('{"shouldReply":true}');
		const service = new MarkovIntentService(classify);

		await expect(service.shouldReply(input, 'channel-1')).resolves.toBe(true);
		expect(classify).toHaveBeenCalledWith(input, 'channel-1');
	});

	it('suppresses a reply when the message is unrelated', async () => {
		const service = new MarkovIntentService(async () => '{"shouldReply":false}');

		await expect(service.shouldReply({ ...input, content: 'Anyone watching the game?' }, 'channel-1'))
			.resolves.toBe(false);
	});

	it('fails closed when intent detection errors', async () => {
		const service = new MarkovIntentService(async () => {
			throw new Error('model timed out');
		});

		await expect(service.shouldReply(input, 'channel-1')).resolves.toBe(false);
	});

	it('fails closed when intent detection returns malformed output', async () => {
		const service = new MarkovIntentService(async () => 'yes');

		await expect(service.shouldReply(input, 'channel-1')).resolves.toBe(false);
	});
});
