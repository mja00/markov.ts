import { boundedInteger } from './web-config.js';

/** Limits on how much work Markov may do across tool rounds before a single reply. */
export type ReplyBudget = {
	maxToolRounds: number;
	// Summed usage.output_tokens (reasoning, text, and tool arguments) across every call in the reply.
	maxOutputTokens: number;
	// Once elapsed, the next follow-up is the last so the reply lands before timeoutMs aborts it.
	wrapUpAfterMs: number;
	timeoutMs: number;
};

// Sized for gpt-6-luna at max effort: a single hard round measured ~135s and ~18k output tokens (~$0.009), so time binds before cost.
const DEFAULT_REPLY_BUDGET: ReplyBudget = {
	maxToolRounds: 10,
	maxOutputTokens: 100000,
	wrapUpAfterMs: 240000,
	timeoutMs: 480000,
};

export function resolveReplyBudget(rawConfig: unknown): ReplyBudget {
	const raw = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
		? rawConfig as Record<string, unknown>
		: {};
	const timeoutMs = boundedInteger(raw.timeoutMs, DEFAULT_REPLY_BUDGET.timeoutMs, 10000, 900000);
	return {
		maxToolRounds: boundedInteger(raw.maxToolRounds, DEFAULT_REPLY_BUDGET.maxToolRounds, 1, 20),
		maxOutputTokens: boundedInteger(raw.maxOutputTokens, DEFAULT_REPLY_BUDGET.maxOutputTokens, 1000, 1_000_000),
		// Half the timeout, like the defaults, so a short timeoutMs without wrapUpAfterMs still leaves time for the final answer.
		wrapUpAfterMs: boundedInteger(raw.wrapUpAfterMs, Math.min(DEFAULT_REPLY_BUDGET.wrapUpAfterMs, Math.floor(timeoutMs / 2)), 5000, timeoutMs),
		timeoutMs,
	};
}
