import { Logger } from './logger.js';

export type MarkovIntentInput = {
	content: string;
	botMentioned: boolean;
	isDirectMessage: boolean;
	isReplyToMarkov: boolean;
	isConversationFollowUp: boolean;
	referencedMessage?: {
		author: string;
		content: string;
	};
	imageUrl?: string;
};

export type MarkovIntentResult = {
	shouldReply: boolean;
	shouldReact: boolean;
};

export type MarkovIntentModel = (
	input: MarkovIntentInput,
	routingKey: string,
) => Promise<string | null>;

/**
 * Applies the intent model as a fail-closed gate before Markov replies or reacts.
 */
export class MarkovIntentService {
	public constructor(private readonly classify: MarkovIntentModel) {}

	public async decide(input: MarkovIntentInput, routingKey: string): Promise<MarkovIntentResult> {
		// Reactions are intentionally guild-only. DMs keep their authoritative reply
		// behavior without paying for a classifier that cannot enable another action.
		if (input.isDirectMessage) {
			return { shouldReply: true, shouldReact: false };
		}

		const authoritativeReply = input.botMentioned || input.isReplyToMarkov;
		try {
			const output = await this.classify(input, routingKey);
			if (!output) {
				return { shouldReply: authoritativeReply, shouldReact: false };
			}

			const parsed: unknown = JSON.parse(output);
			if (!this.isIntentResult(parsed)) {
				return { shouldReply: authoritativeReply, shouldReact: false };
			}

			return {
				shouldReply: authoritativeReply
					|| ((this.namesMarkov(input.content) || input.isConversationFollowUp) && parsed.shouldReply),
				shouldReact: parsed.shouldReact,
			};
		} catch (error) {
			Logger.warn('Markov intent detection failed; skipping optional AI actions:', error);
			return { shouldReply: authoritativeReply, shouldReact: false };
		}
	}

	private namesMarkov(content: string): boolean {
		return /\bmarkov\b/i.test(content);
	}

	private isIntentResult(value: unknown): value is MarkovIntentResult {
		return typeof value === 'object'
			&& value !== null
			&& 'shouldReply' in value
			&& typeof value.shouldReply === 'boolean'
			&& 'shouldReact' in value
			&& typeof value.shouldReact === 'boolean';
	}
}
