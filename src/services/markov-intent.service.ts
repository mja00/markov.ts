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
