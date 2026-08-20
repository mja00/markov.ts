import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEvalDataset } from '../../../src/evals/dataset.js';

describe('eval dataset', () => {
	it('contains only valid cases with implemented evaluators', () => {
		const source = fs.readFileSync(path.join(process.cwd(), 'evals', 'dataset.jsonl'), 'utf8');
		const cases = parseEvalDataset(source);

		expect(cases.length).toBeGreaterThan(0);
	});

	it('rejects duplicate ids', () => {
		const evalCase = JSON.stringify({
			id: 'duplicate',
			category: 'intent_detection',
			input: {
				message: 'Markov?',
				botMentioned: false,
				isDirectMessage: false,
				isReplyToMarkov: false,
			},
			expected: { shouldReply: true },
			tags: [],
		});

		expect(() => parseEvalDataset(`${evalCase}\n${evalCase}`))
			.toThrow('Duplicate eval case id: duplicate');
	});

	it('rejects categories without an evaluator', () => {
		const evalCase = JSON.stringify({
			id: 'unsupported',
			category: 'future_category',
			input: {},
			expected: {},
			tags: [],
		});

		expect(() => parseEvalDataset(evalCase))
			.toThrow('category must have an implemented evaluator: future_category');
	});

	it('rejects invalid conversation follow-up metadata', () => {
		const evalCase = JSON.stringify({
			id: 'invalid-follow-up',
			category: 'intent_detection',
			input: {
				message: 'tell me more',
				botMentioned: false,
				isDirectMessage: false,
				isReplyToMarkov: false,
				isConversationFollowUp: 'yes',
			},
			expected: { shouldReply: true },
			tags: [],
		});

		expect(() => parseEvalDataset(evalCase))
			.toThrow('input.isConversationFollowUp must be a boolean when provided');
	});
});
