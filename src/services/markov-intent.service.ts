import { Logger } from './logger.js';

export type MarkovIntentInput = {
	content: string;
	botMentioned: boolean;
	isDirectMessage: boolean;
	isReplyToMarkov: boolean;
};

export type MarkovIntentModel = (
	input: MarkovIntentInput,
	routingKey: string,
) => Promise<string | null>;

/**
 * Applies the intent model as a fail-closed gate before Markov generates a reply.
 */
export class MarkovIntentService {
	public constructor(private readonly classify: MarkovIntentModel) {}

	public async shouldReply(input: MarkovIntentInput, routingKey: string): Promise<boolean> {
		// The metadata flags are authoritative, so skip the classifier: this saves a
		// call and stops the fail-closed catch from ignoring genuine @mentions on timeout.
		if (input.botMentioned || input.isDirectMessage || input.isReplyToMarkov) {
			return true;
		}

		// Without a flag, a reply requires the bot's name — the classifier only exists
		// to disambiguate "the Markov bot" from "Markov chain", so never send it
		// messages it could only false-positive on.
		if (!/markov/i.test(input.content)) {
			return false;
		}

		try {
			const output = await this.classify(input, routingKey);
			if (!output) {
				return false;
			}

			const parsed: unknown = JSON.parse(output);
			return this.isIntentResult(parsed) && parsed.shouldReply;
		} catch (error) {
			Logger.warn('Markov intent detection failed; skipping AI reply:', error);
			return false;
		}
	}

	private isIntentResult(value: unknown): value is { shouldReply: boolean; } {
		return typeof value === 'object'
			&& value !== null
			&& 'shouldReply' in value
			&& typeof value.shouldReply === 'boolean';
	}
}
