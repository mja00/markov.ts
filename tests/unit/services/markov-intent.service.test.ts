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

	it('suppresses a reply without classifying when the message never names Markov', async () => {
		const classify = vi.fn().mockResolvedValue('{"shouldReply":true}');
		const service = new MarkovIntentService(classify);

		await expect(service.shouldReply({ ...input, content: 'Anyone watching the game?' }, 'channel-1'))
			.resolves.toBe(false);
		expect(classify).not.toHaveBeenCalled();
	});

	// Regression: long second-person-heavy messages were misclassified by the
	// intent model as addressing the bot despite never naming it.
	it('suppresses a reply to long conversational messages that never name Markov', async () => {
		const classify = vi.fn().mockResolvedValue('{"shouldReply":true}');
		const service = new MarkovIntentService(classify);
		const content = `Aside from how the pacing & audio-visual layer in those episodes *(so, the \`"technical"\` stuff)* was handled, I'm honestly curious how different everything would feel / end up as story-wise, if ||Gabi actually killed Eren with that sniper rifle shot|| - instead of ||him getting miraculously saved & all that followed|| <:jayethHmm:726681883290632192>

I doubt many authors would make such a decision, but it would have been an interesting subversion of expectations, you know? In many different ways.`;

		await expect(service.shouldReply({ ...input, content }, 'channel-1')).resolves.toBe(false);
		expect(classify).not.toHaveBeenCalled();
	});

	it.each([
		['botMentioned', { ...input, content: 'no name here', botMentioned: true }],
		['isDirectMessage', { ...input, content: 'no name here', isDirectMessage: true }],
		['isReplyToMarkov', { ...input, content: 'no name here', isReplyToMarkov: true }],
	])('replies without classifying when %s is set', async (_flag, flaggedInput) => {
		const classify = vi.fn().mockResolvedValue('{"shouldReply":false}');
		const service = new MarkovIntentService(classify);

		await expect(service.shouldReply(flaggedInput, 'channel-1')).resolves.toBe(true);
		expect(classify).not.toHaveBeenCalled();
	});

	it('still defers to the classifier for ambiguous mentions of the name', async () => {
		const classify = vi.fn().mockResolvedValue('{"shouldReply":false}');
		const service = new MarkovIntentService(classify);

		await expect(service.shouldReply({ ...input, content: 'We should use a Markov chain for this simulation' }, 'channel-1'))
			.resolves.toBe(false);
		expect(classify).toHaveBeenCalledOnce();
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
