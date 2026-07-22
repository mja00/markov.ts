import fs from 'node:fs';
import path from 'node:path';

import OpenAI from 'openai';

import { EvalCase, parseEvalDataset } from '../evals/dataset.js';
import { MARKOV_INTENT_INSTRUCTIONS, MARKOV_INTENT_RESPONSE_FORMAT } from '../prompts/markov-intent-prompt.js';

type LocalConfig = {
	openai?: { apiKey?: string; };
	aiRouting?: {
		tasks?: {
			intent_detection?: {
				model?: string;
			};
		};
	};
};

type IntentResult = {
	shouldReply: boolean;
	shouldReact: boolean;
};

type EvalRuntime = {
	client: OpenAI;
	model: string;
	maxOutputTokens: number;
	timeoutMs: number;
};

function readLocalConfig(configPath: string): LocalConfig {
	if (!fs.existsSync(configPath)) {
		return {};
	}
	return JSON.parse(fs.readFileSync(configPath, 'utf8')) as LocalConfig;
}

function isIntentResult(value: unknown): value is IntentResult {
	return typeof value === 'object'
		&& value !== null
		&& 'shouldReply' in value
		&& typeof value.shouldReply === 'boolean'
		&& 'shouldReact' in value
		&& typeof value.shouldReact === 'boolean';
}

function grade(evalCase: EvalCase, actual: IntentResult): string[] {
	const differences: string[] = [];
	if (actual.shouldReply !== evalCase.expected.shouldReply) {
		differences.push(
			`shouldReply expected ${evalCase.expected.shouldReply}, received ${actual.shouldReply}`,
		);
	}
	if (
		evalCase.expected.shouldReact !== undefined
		&& actual.shouldReact !== evalCase.expected.shouldReact
	) {
		differences.push(
			`shouldReact expected ${evalCase.expected.shouldReact}, received ${actual.shouldReact}`,
		);
	}
	return differences;
}

function assertNever(value: never): never {
	throw new Error(`Eval category does not have a runner: ${JSON.stringify(value)}`);
}

async function runIntentDetectionEval(
	evalCase: EvalCase,
	runtime: EvalRuntime,
): Promise<IntentResult> {
	const response = await runtime.client.responses.create({
		model: runtime.model,
		instructions: MARKOV_INTENT_INSTRUCTIONS,
		input: JSON.stringify({
			content: evalCase.input.message,
			botMentioned: evalCase.input.botMentioned,
			isDirectMessage: evalCase.input.isDirectMessage,
			isReplyToMarkov: evalCase.input.isReplyToMarkov,
			hasImage: false,
		}),
		store: false,
		max_output_tokens: runtime.maxOutputTokens,
		reasoning: { effort: 'low' },
		text: {
			format: MARKOV_INTENT_RESPONSE_FORMAT,
		},
	}, { timeout: runtime.timeoutMs });

	const parsed: unknown = JSON.parse(response.output_text);
	if (!isIntentResult(parsed)) {
		throw new Error('model returned an invalid intent result');
	}
	return parsed;
}

async function runEval(evalCase: EvalCase, runtime: EvalRuntime): Promise<IntentResult> {
	switch (evalCase.category) {
		case 'intent_detection': {
			return runIntentDetectionEval(evalCase, runtime);
		}
		default: {
			return assertNever(evalCase.category);
		}
	}
}

async function main(): Promise<void> {
	const rootDirectory = process.cwd();
	const datasetPath = path.join(rootDirectory, 'evals', 'dataset.jsonl');
	const config = readLocalConfig(path.join(rootDirectory, 'config', 'config.json'));
	const apiKey = process.env.OPENAI_API_KEY?.trim() || config.openai?.apiKey?.trim();

	if (!apiKey) {
		throw new Error(
			'OpenAI API key not found. Set OPENAI_API_KEY or configure openai.apiKey in config/config.json.',
		);
	}

	const intentSettings = config.aiRouting?.tasks?.intent_detection;
	const runtime: EvalRuntime = {
		client: new OpenAI({ apiKey }),
		model: process.env.MARKOV_INTENT_EVAL_MODEL?.trim()
			|| intentSettings?.model
			|| 'gpt-5.4-nano',
		maxOutputTokens: 512,
		timeoutMs: 3000,
	};
	const evalCases = parseEvalDataset(fs.readFileSync(datasetPath, 'utf8'));
	let failures = 0;
	console.log(`Running ${evalCases.length} live AI evals with ${runtime.model}`);

	for (const evalCase of evalCases) {
		try {
			const actual = await runEval(evalCase, runtime);
			const differences = grade(evalCase, actual);
			if (differences.length === 0) {
				console.log(`PASS ${evalCase.id}`);
				continue;
			}

			failures++;
			console.error(`FAIL ${evalCase.id}: ${differences.join(', ')}`);
		} catch (error) {
			failures++;
			const message = error instanceof Error ? error.message : String(error);
			console.error(`ERROR ${evalCase.id}: ${message}`);
		}
	}

	if (failures > 0) {
		console.error(`${failures}/${evalCases.length} evals failed`);
		process.exitCode = 1;
	} else {
		console.log(`All ${evalCases.length} evals passed`);
	}
}

await main();
