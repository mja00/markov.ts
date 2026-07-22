export const EVAL_CATEGORIES = ['intent_detection'] as const;

export type EvalCategory = typeof EVAL_CATEGORIES[number];

export type IntentDetectionEvalCase = {
	id: string;
	category: 'intent_detection';
	input: {
		message: string;
		botMentioned: boolean;
		isDirectMessage: boolean;
		isReplyToMarkov: boolean;
	};
	expected: {
		shouldReply: boolean;
		shouldReact?: boolean;
	};
	tags: string[];
};

export type EvalCase = IntentDetectionEvalCase;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidCase(lineNumber: number, message: string): Error {
	return new Error(`Invalid eval case on line ${lineNumber}: ${message}`);
}

function validateIntentDetectionCase(
	value: Record<string, unknown>,
	lineNumber: number,
): IntentDetectionEvalCase {
	if (!isRecord(value.input)) {
		throw invalidCase(lineNumber, 'input must be an object');
	}
	if (typeof value.input.message !== 'string' || value.input.message.trim() === '') {
		throw invalidCase(lineNumber, 'input.message must be a non-empty string');
	}
	for (const field of ['botMentioned', 'isDirectMessage', 'isReplyToMarkov'] as const) {
		if (typeof value.input[field] !== 'boolean') {
			throw invalidCase(lineNumber, `input.${field} must be a boolean`);
		}
	}
	if (!isRecord(value.expected) || typeof value.expected.shouldReply !== 'boolean') {
		throw invalidCase(lineNumber, 'expected.shouldReply must be a boolean');
	}
	if (
		value.expected.shouldReact !== undefined
		&& typeof value.expected.shouldReact !== 'boolean'
	) {
		throw invalidCase(lineNumber, 'expected.shouldReact must be a boolean when provided');
	}

	return value as IntentDetectionEvalCase;
}

function validateEvalCase(value: unknown, lineNumber: number): EvalCase {
	if (!isRecord(value)) {
		throw invalidCase(lineNumber, 'case must be an object');
	}
	if (typeof value.id !== 'string' || value.id.trim() === '') {
		throw invalidCase(lineNumber, 'id must be a non-empty string');
	}
	if (!EVAL_CATEGORIES.includes(value.category as EvalCategory)) {
		throw invalidCase(lineNumber, `category must have an implemented evaluator: ${String(value.category)}`);
	}
	if (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string')) {
		throw invalidCase(lineNumber, 'tags must be an array of strings');
	}

	switch (value.category) {
		case 'intent_detection': {
			return validateIntentDetectionCase(value, lineNumber);
		}
		default: {
			throw invalidCase(
				lineNumber,
				`category does not have a validator: ${String(value.category)}`,
			);
		}
	}
}

export function parseEvalDataset(source: string): EvalCase[] {
	const cases = source
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean)
		.map((line, index) => {
			try {
				return validateEvalCase(JSON.parse(line), index + 1);
			} catch (error) {
				if (error instanceof SyntaxError) {
					throw new Error(
						`Invalid JSON on eval dataset line ${index + 1}: ${error.message}`,
						{ cause: error },
					);
				}
				throw error;
			}
		});

	const seenIds = new Set<string>();
	for (const evalCase of cases) {
		if (seenIds.has(evalCase.id)) {
			throw new Error(`Duplicate eval case id: ${evalCase.id}`);
		}
		seenIds.add(evalCase.id);
	}

	if (cases.length === 0) {
		throw new Error('Eval dataset must contain at least one case');
	}

	return cases;
}
