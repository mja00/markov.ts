import { TypeSafeClient } from '@typesafe-ai/sdk';

import { MARKOV_ADDRESSED_QUESTION, MARKOV_CONTINUATION_QUESTION, MARKOV_REACT_QUESTION } from '../prompts/markov-intent-prompt.js';

import type { MarkovIntentModel } from './markov-intent.service.js';
import type { NoulQuestion } from '@typesafe-ai/sdk';

export type TypeSafeIntentSettings = {
	apiKey?: string;
	model?: string;
	timeoutMs?: number;
};

// Pinned rather than jev-latest because the intent thresholds are tuned against this version.
export const DEFAULT_TYPESAFE_INTENT_MODEL = 'jev-1.13.0';

export function createTypeSafeIntentModel(settings: TypeSafeIntentSettings = {}): MarkovIntentModel {
	let client: TypeSafeClient | undefined;

	return async (input, request) => {
		// Built on first use so a missing API key fails closed per message instead of crashing startup.
		client ??= new TypeSafeClient({
			apiKey: process.env.TYPESAFE_API_KEY?.trim() || settings.apiKey || undefined,
			defaultModel: settings.model ?? DEFAULT_TYPESAFE_INTENT_MODEL,
			timeout: settings.timeoutMs ?? 3000,
			// Every guild message waits on this call, so keep the worst case close to one timeout.
			retry: { maxRetries: 1 },
		});

		const questions: Record<string, NoulQuestion> = { react: MARKOV_REACT_QUESTION };
		if (request.addressed) {
			questions.addressed = MARKOV_ADDRESSED_QUESTION;
		}
		if (request.continuation) {
			questions.continuation = MARKOV_CONTINUATION_QUESTION;
		}

		const { answers } = await client.systemOne({
			state: {
				message: {
					content: input.content,
					...(input.hasImage && { hasImage: true }),
				},
				...(input.referencedMessage && { repliedToMessage: input.referencedMessage }),
			},
			questions,
		});

		return {
			react: answers.react.noul,
			addressed: answers.addressed?.noul,
			continuation: answers.continuation?.noul,
		};
	};
}
