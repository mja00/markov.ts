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

import type { MarkovIntentJudgments } from '../../../src/services/markov-intent.service.js';

const input = {
	content: 'Markov, what do you think?',
	botMentioned: false,
	isDirectMessage: false,
	isReplyToMarkov: false,
	isConversationFollowUp: false,
};

function serviceReturning(judgments: MarkovIntentJudgments) {
	const classify = vi.fn().mockResolvedValue(judgments);
	return { classify, service: new MarkovIntentService(classify, { reply: 0.6, react: 0.7 }) };
}

describe('MarkovIntentService', () => {
	it('replies when Markov is named and the addressed probability clears the threshold', async () => {
		const { classify, service } = serviceReturning({ addressed: 0.6, react: 0.1 });

		await expect(service.decide(input)).resolves.toEqual({ shouldReply: true, shouldReact: false });
		expect(classify).toHaveBeenCalledWith(input, { addressed: true, continuation: false, react: true });
	});

	it('stays silent when the addressed probability is below the threshold', async () => {
		const { service } = serviceReturning({ addressed: 0.59, react: 0.1 });

		await expect(service.decide(input)).resolves.toEqual({ shouldReply: false, shouldReact: false });
	});

	it('reacts independently from replying', async () => {
		const { service } = serviceReturning({ addressed: 0.1, react: 0.7 });

		await expect(service.decide(input)).resolves.toEqual({ shouldReply: false, shouldReact: true });
	});

	it('never asks for or honours an addressed judgment when Markov is not named', async () => {
		const { classify, service } = serviceReturning({ addressed: 1, react: 0 });

		await expect(service.decide({ ...input, content: 'Now make him respond to everything' }))
			.resolves.toEqual({ shouldReply: false, shouldReact: false });
		expect(classify).toHaveBeenCalledWith(expect.anything(), { addressed: false, continuation: false, react: true });
	});

	it('does not match the name inside another word', async () => {
		const { classify, service } = serviceReturning({ react: 0 });

		await service.decide({ ...input, content: 'markovian processes are neat' });
		expect(classify).toHaveBeenCalledWith(expect.anything(), { addressed: false, continuation: false, react: true });
	});

	it('replies to a continuation during an open conversation turn', async () => {
		const { classify, service } = serviceReturning({ continuation: 0.8, react: 0 });
		const followUp = { ...input, content: 'yeah, tell me more', isConversationFollowUp: true };

		await expect(service.decide(followUp)).resolves.toEqual({ shouldReply: true, shouldReact: false });
		expect(classify).toHaveBeenCalledWith(followUp, { addressed: false, continuation: true, react: true });
	});

	it('rejects an unrelated message during an open turn', async () => {
		const { service } = serviceReturning({ continuation: 0.2, react: 0 });

		await expect(service.decide({ ...input, content: 'Anyone watching the game?', isConversationFollowUp: true }))
			.resolves.toEqual({ shouldReply: false, shouldReact: false });
	});

	it('replies when either requested judgment passes', async () => {
		const { service } = serviceReturning({ addressed: 0.1, continuation: 0.9, react: 0 });

		await expect(service.decide({ ...input, isConversationFollowUp: true }))
			.resolves.toEqual({ shouldReply: true, shouldReact: false });
	});

	it.each([
		['botMentioned', { ...input, content: 'no name here', botMentioned: true }],
		['isReplyToMarkov', { ...input, content: 'markov no name here', isReplyToMarkov: true, isConversationFollowUp: true }],
	])('keeps authoritative replies and only asks about reacting when %s is set', async (_flag, flaggedInput) => {
		const { classify, service } = serviceReturning({ react: 0.9 });

		await expect(service.decide(flaggedInput)).resolves.toEqual({ shouldReply: true, shouldReact: true });
		expect(classify).toHaveBeenCalledWith(flaggedInput, { addressed: false, continuation: false, react: true });
	});

	it('skips the model and never reacts to a message with no text', async () => {
		const { classify, service } = serviceReturning({ react: 1 });

		await expect(service.decide({ ...input, content: '  ' }))
			.resolves.toEqual({ shouldReply: false, shouldReact: false });
		expect(classify).not.toHaveBeenCalled();
	});

	it('replies to DMs without calling the model', async () => {
		const { classify, service } = serviceReturning({ react: 1 });

		await expect(service.decide({ ...input, isDirectMessage: true }))
			.resolves.toEqual({ shouldReply: true, shouldReact: false });
		expect(classify).not.toHaveBeenCalled();
	});

	it('fails closed when a requested judgment is missing', async () => {
		const { service } = serviceReturning({ react: 0.1 });

		await expect(service.decide(input)).resolves.toEqual({ shouldReply: false, shouldReact: false });
	});

	it('fails closed when intent detection errors', async () => {
		const service = new MarkovIntentService(async () => {
			throw new Error('model timed out');
		});

		await expect(service.decide(input)).resolves.toEqual({ shouldReply: false, shouldReact: false });
	});

	it('keeps an authoritative reply when classification fails', async () => {
		const service = new MarkovIntentService(async () => {
			throw new Error('model timed out');
		});

		await expect(service.decide({ ...input, botMentioned: true }))
			.resolves.toEqual({ shouldReply: true, shouldReact: false });
	});
});
