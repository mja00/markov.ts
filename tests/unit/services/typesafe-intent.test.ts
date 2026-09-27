import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

const { systemOne, constructorConfigs } = vi.hoisted(() => {
	return { systemOne: vi.fn(), constructorConfigs: [] as unknown[] };
});

vi.mock('@typesafe-ai/sdk', async (importOriginal) => {
	const actual = await importOriginal<typeof TypeSafeSdk>();
	return {
		...actual,
		TypeSafeClient: class {
			public systemOne = systemOne;

			public constructor(config: unknown) {
				constructorConfigs.push(config);
			}
		},
	};
});

import { MARKOV_ADDRESSED_QUESTION, MARKOV_CONTINUATION_QUESTION, MARKOV_REACT_QUESTION } from '../../../src/prompts/markov-intent-prompt.js';
import { createTypeSafeIntentModel } from '../../../src/services/typesafe-intent.js';

import type * as TypeSafeSdk from '@typesafe-ai/sdk';

const input = {
	content: 'markov what now',
	botMentioned: false,
	isDirectMessage: false,
	isReplyToMarkov: false,
	isConversationFollowUp: true,
	hasImage: false,
};

describe('createTypeSafeIntentModel', () => {
	beforeEach(() => {
		systemOne.mockReset();
		constructorConfigs.length = 0;
	});

	it('sends only the requested questions and maps each answer to its judgment', async () => {
		systemOne.mockResolvedValue({
			answers: {
				addressed: { type: 'noul', noul: 0.91 },
				continuation: { type: 'noul', noul: 0.12 },
				react: { type: 'noul', noul: 0.34 },
			},
		});
		const classify = createTypeSafeIntentModel({ apiKey: 'test-key' });

		await expect(classify(input, { addressed: true, continuation: true, react: true }))
			.resolves.toEqual({ addressed: 0.91, continuation: 0.12, react: 0.34 });
		expect(systemOne).toHaveBeenCalledWith({
			state: { message: { content: 'markov what now' } },
			questions: {
				addressed: MARKOV_ADDRESSED_QUESTION,
				continuation: MARKOV_CONTINUATION_QUESTION,
				react: MARKOV_REACT_QUESTION,
			},
		});
	});

	it('omits unrequested questions and leaves their judgments undefined', async () => {
		systemOne.mockResolvedValue({ answers: { addressed: { type: 'noul', noul: 0.8 } } });
		const classify = createTypeSafeIntentModel({ apiKey: 'test-key' });

		await expect(classify(input, { addressed: true, continuation: false, react: false }))
			.resolves.toEqual({ addressed: 0.8, continuation: undefined, react: undefined });
		expect(systemOne.mock.calls[0][0].questions).toEqual({ addressed: MARKOV_ADDRESSED_QUESTION });
	});

	it('includes the replied-to message in state when present', async () => {
		systemOne.mockResolvedValue({ answers: { react: { type: 'noul', noul: 0.2 } } });
		const classify = createTypeSafeIntentModel({ apiKey: 'test-key' });
		const referencedMessage = { author: 'sam', content: 'who wants pizza' };

		await classify({ ...input, referencedMessage }, { addressed: false, continuation: false, react: true });
		expect(systemOne.mock.calls[0][0].state).toEqual({
			message: { content: 'markov what now' },
			repliedToMessage: referencedMessage,
		});
	});

	it('pins the default model and reuses one client across calls', async () => {
		systemOne.mockResolvedValue({ answers: { react: { type: 'noul', noul: 0.2 } } });
		const classify = createTypeSafeIntentModel({ apiKey: 'test-key' });
		const request = { addressed: false, continuation: false, react: true };

		await classify(input, request);
		await classify(input, request);
		expect(constructorConfigs).toHaveLength(1);
		expect(constructorConfigs[0]).toMatchObject({ defaultModel: 'jev-1.13.0', timeout: 3000 });
	});
});
