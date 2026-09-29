import fs from 'node:fs';
import path from 'node:path';

import { EvalCase, parseEvalDataset } from '../evals/dataset.js';
import {
	DEFAULT_MARKOV_INTENT_THRESHOLDS,
	MarkovIntentJudgments,
	MarkovIntentResult,
	MarkovIntentService,
	MarkovIntentThresholds,
} from '../services/markov-intent.service.js';
import { DEFAULT_TYPESAFE_INTENT_MODEL, TypeSafeIntentSettings, createTypeSafeIntentModel } from '../services/typesafe-intent.js';

type LocalConfig = {
	typesafe?: TypeSafeIntentSettings & { intentThresholds?: Partial<MarkovIntentThresholds>; };
};

function readLocalConfig(configPath: string): LocalConfig {
	if (!fs.existsSync(configPath)) {
		return {};
	}
	return JSON.parse(fs.readFileSync(configPath, 'utf8')) as LocalConfig;
}

function grade(evalCase: EvalCase, actual: MarkovIntentResult): string[] {
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

function formatJudgments(judgments: MarkovIntentJudgments | undefined): string {
	if (!judgments) {
		return 'no model call';
	}
	return Object.entries(judgments)
		.filter(([, probability]) => probability !== undefined)
		.map(([name, probability]) => `${name}=${(probability as number).toFixed(3)}`)
		.join(' ');
}

async function main(): Promise<void> {
	const rootDirectory = process.cwd();
	const datasetPath = path.join(rootDirectory, 'evals', 'dataset.jsonl');
	const config = readLocalConfig(path.join(rootDirectory, 'config', 'config.json'));
	const model = process.env.MARKOV_INTENT_EVAL_MODEL?.trim()
		|| config.typesafe?.model
		|| DEFAULT_TYPESAFE_INTENT_MODEL;
	const thresholds = { ...DEFAULT_MARKOV_INTENT_THRESHOLDS, ...config.typesafe?.intentThresholds };
	const classify = createTypeSafeIntentModel({ ...config.typesafe, model });
	const evalCases = parseEvalDataset(fs.readFileSync(datasetPath, 'utf8'));
	let failures = 0;
	console.log(`Running ${evalCases.length} live AI evals with ${model} (reply>=${thresholds.reply}, react>=${thresholds.react})`);

	for (const evalCase of evalCases) {
		let judgments: MarkovIntentJudgments | undefined;
		let modelError: unknown;
		const service = new MarkovIntentService(async (input, request) => {
			try {
				judgments = await classify(input, request);
				return judgments;
			} catch (error) {
				modelError = error;
				throw error;
			}
		}, thresholds);
		const actual = await service.decide({
			content: evalCase.input.message,
			botMentioned: evalCase.input.botMentioned,
			isDirectMessage: evalCase.input.isDirectMessage,
			isReplyToMarkov: evalCase.input.isReplyToMarkov,
			isConversationFollowUp: evalCase.input.isConversationFollowUp ?? false,
		});
		// The service fails closed, so surface model errors instead of grading the fallback.
		if (modelError) {
			failures++;
			const message = modelError instanceof Error ? modelError.message : String(modelError);
			console.error(`ERROR ${evalCase.id}: ${message}`);
			continue;
		}

		const differences = grade(evalCase, actual);
		if (differences.length === 0) {
			console.log(`PASS ${evalCase.id} (${formatJudgments(judgments)})`);
			continue;
		}

		failures++;
		console.error(`FAIL ${evalCase.id}: ${differences.join(', ')} (${formatJudgments(judgments)})`);
	}

	if (failures > 0) {
		console.error(`${failures}/${evalCases.length} evals failed`);
		process.exitCode = 1;
	} else {
		console.log(`All ${evalCases.length} evals passed`);
	}
}

await main();
