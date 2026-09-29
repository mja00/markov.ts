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
};

export type MarkovIntentResult = {
	shouldReply: boolean;
	shouldReact: boolean;
};

/** Which judgments the model must answer for this message. */
export type MarkovIntentJudgmentRequest = {
	addressed: boolean;
	continuation: boolean;
	react: boolean;
};

/** Yes-probabilities for each requested judgment. */
export type MarkovIntentJudgments = {
	addressed?: number;
	continuation?: number;
	react?: number;
};

export type MarkovIntentModel = (
	input: MarkovIntentInput,
	request: MarkovIntentJudgmentRequest,
) => Promise<MarkovIntentJudgments>;

export type MarkovIntentThresholds = {
	reply: number;
	react: number;
};

// Tuned on evals/dataset.jsonl with jev-1.13.0: reply scores split at 0.14/0.69, react needs 0.8 to skip borderline chatter.
export const DEFAULT_MARKOV_INTENT_THRESHOLDS: MarkovIntentThresholds = {
	reply: 0.5,
	react: 0.8,
};

/**
 * Applies the intent model as a fail-closed gate before Markov replies or reacts.
 */
export class MarkovIntentService {
	public constructor(
		private readonly classify: MarkovIntentModel,
		private readonly thresholds: MarkovIntentThresholds = DEFAULT_MARKOV_INTENT_THRESHOLDS,
	) {}

	private passes(probability: number | undefined, threshold: number): boolean {
		return probability !== undefined && probability >= threshold;
	}

	public async decide(input: MarkovIntentInput): Promise<MarkovIntentResult> {
		// Reactions are intentionally guild-only. DMs keep their authoritative reply
		// behavior without paying for a classifier that cannot enable another action.
		if (input.isDirectMessage) {
			return { shouldReply: true, shouldReact: false };
		}

		const authoritativeReply = input.botMentioned || input.isReplyToMarkov;
		// Optional replies need the name or an open turn, so skip judgments code would ignore.
		// Jev is text-only, so caption-less image posts get no reaction rather than bypassing the gate.
		const request: MarkovIntentJudgmentRequest = {
			addressed: !authoritativeReply && /\bmarkov\b/i.test(input.content),
			continuation: !authoritativeReply && input.isConversationFollowUp,
			react: input.content.trim() !== '',
		};
		if (!request.addressed && !request.continuation && !request.react) {
			return { shouldReply: authoritativeReply, shouldReact: false };
		}

		try {
			const judgments = await this.classify(input, request);
			const addressed = request.addressed && this.passes(judgments.addressed, this.thresholds.reply);
			const continuation = request.continuation && this.passes(judgments.continuation, this.thresholds.reply);
			const react = request.react && this.passes(judgments.react, this.thresholds.react);

			return {
				shouldReply: authoritativeReply || addressed || continuation,
				shouldReact: react,
			};
		} catch (error) {
			Logger.warn('Markov intent detection failed; skipping optional AI actions:', error);
			return { shouldReply: authoritativeReply, shouldReact: false };
		}
	}
}
