import { Logger } from './logger.js';

export const AI_TASK_TYPES = [
	'intent_detection',
	'memory_extraction',
	'summarization',
	'tool_selection',
	'final_response',
	'image_analysis',
] as const;

export type AITaskType = typeof AI_TASK_TYPES[number];

export interface ModelTaskSettings {
	model?: string;
	fallbackModel?: string;
	maxOutputTokens?: number;
	timeoutMs?: number;
	maxCostUsd?: number;
}

export interface ModelPrice {
	inputPerMillion: number;
	outputPerMillion: number;
}

export interface ModelRoutingConfig {
	enabled?: boolean;
	rolloutPercent?: number;
	dataProvenance?: {
		modelAvailability?: string;
		modelAvailabilityCheckedAt?: string;
		pricing?: string;
		pricingCheckedAt?: string;
		usageBasedPolicy?: boolean;
	};
	tasks?: Partial<Record<AITaskType, ModelTaskSettings>>;
	prices?: Record<string, ModelPrice>;
	telemetry?: { enabled?: boolean; };
}

export interface ModelRoute {
	task: AITaskType;
	model: string;
	fallbackModel?: string;
	maxOutputTokens?: number;
	timeoutMs?: number;
	maxCostUsd?: number;
	routed: boolean;
}

export interface ModelUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
}

export interface ModelTelemetryEvent {
	task: AITaskType;
	model: string;
	latencyMs: number;
	usage: ModelUsage;
	toolCalls: string[];
	estimatedCostUsd?: number;
	success: boolean;
	fallbackFrom?: string;
	error?: string;
	timestamp: string;
}

export interface ModelTelemetrySink {
	record(event: ModelTelemetryEvent): void | Promise<void>;
}

export class InMemoryModelTelemetrySink implements ModelTelemetrySink {
	public readonly events: ModelTelemetryEvent[] = [];

	public record(event: ModelTelemetryEvent): void {
		this.events.push(event);
	}
}

class LoggerModelTelemetrySink implements ModelTelemetrySink {
	public record(event: ModelTelemetryEvent): void {
		Logger.info('[AI telemetry]', event);
	}
}

type ResponseLike = {
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		total_tokens?: number;
	};
	output?: Array<{ type?: string; name?: string; }>;
};

/**
 * Selects per-task model limits and wraps calls with uniform telemetry/fallbacks.
 * Rollout assignment is a stable hash so a channel does not bounce between the
 * baseline and routed model on successive messages.
 */
export class ModelRouter {
	private readonly sink?: ModelTelemetrySink;

	public constructor(
		private readonly config: ModelRoutingConfig = {},
		sink?: ModelTelemetrySink,
	) {
		this.sink = sink ?? (config.telemetry?.enabled ? new LoggerModelTelemetrySink() : undefined);
	}

	public route(task: AITaskType, baselineModel: string, routingKey = ''): ModelRoute {
		const taskSettings = this.config.tasks?.[task] ?? {};
		const rolloutPercent = Math.max(0, Math.min(100, this.config.rolloutPercent ?? 100));
		const routed = Boolean(this.config.enabled)
			&& this.bucket(`${task}:${routingKey}`) < rolloutPercent;
		const model = routed && taskSettings.model ? taskSettings.model : baselineModel;
		const activeSettings = routed ? taskSettings : {};

		return {
			task,
			model,
			fallbackModel: routed ? taskSettings.fallbackModel : undefined,
			maxOutputTokens: this.costCappedOutputTokens(model, activeSettings),
			timeoutMs: activeSettings.timeoutMs,
			maxCostUsd: activeSettings.maxCostUsd,
			routed,
		};
	}

	public async execute<T extends ResponseLike>(
		task: AITaskType,
		baselineModel: string,
		routingKey: string,
		call: (route: ModelRoute) => Promise<T>,
	): Promise<T> {
		const route = this.route(task, baselineModel, routingKey);
		try {
			return await this.runAndRecord(route, call);
		} catch (error) {
			if (!route.fallbackModel || route.fallbackModel === route.model) {
				throw error;
			}

			const fallbackRoute = {
				...route,
				model: route.fallbackModel,
				fallbackModel: undefined,
				maxOutputTokens: this.costCappedOutputTokens(route.fallbackModel, this.config.tasks?.[task] ?? {}),
			};
			return this.runAndRecord(fallbackRoute, call, route.model);
		}
	}

	private async runAndRecord<T extends ResponseLike>(
		route: ModelRoute,
		call: (route: ModelRoute) => Promise<T>,
		fallbackFrom?: string,
	): Promise<T> {
		const startedAt = Date.now();
		try {
			const response = await call(route);
			await this.record(route, startedAt, response, true, fallbackFrom);
			return response;
		} catch (error) {
			await this.record(route, startedAt, undefined, false, fallbackFrom, error);
			throw error;
		}
	}

	private async record(
		route: ModelRoute,
		startedAt: number,
		response: ResponseLike | undefined,
		success: boolean,
		fallbackFrom?: string,
		error?: unknown,
	): Promise<void> {
		if (!this.sink) {
			return;
		}
		const usage = this.readUsage(response);
		let errorMessage: string | undefined;
		if (error instanceof Error) {
			errorMessage = error.message;
		} else if (error !== undefined) {
			errorMessage = String(error);
		}
		await this.sink.record({
			task: route.task,
			model: route.model,
			latencyMs: Date.now() - startedAt,
			usage,
			toolCalls: (response?.output ?? [])
				.filter(item => item.type === 'function_call' || item.type === 'image_generation_call')
				.map(item => item.name ?? item.type ?? 'unknown'),
			estimatedCostUsd: this.estimateCost(route.model, usage),
			success,
			fallbackFrom,
			error: errorMessage,
			timestamp: new Date().toISOString(),
		});
	}

	private readUsage(response?: ResponseLike): ModelUsage {
		return {
			inputTokens: response?.usage?.input_tokens,
			outputTokens: response?.usage?.output_tokens,
			totalTokens: response?.usage?.total_tokens,
		};
	}

	private estimateCost(model: string, usage: ModelUsage): number | undefined {
		const price = this.config.prices?.[model];
		if (!price || usage.inputTokens === undefined || usage.outputTokens === undefined) {
			return undefined;
		}
		const inputCost = usage.inputTokens * price.inputPerMillion;
		const outputCost = usage.outputTokens * price.outputPerMillion;
		return (inputCost + outputCost) / 1_000_000;
	}

	private costCappedOutputTokens(model: string, settings: ModelTaskSettings): number | undefined {
		const configuredLimit = settings.maxOutputTokens;
		const outputPrice = this.config.prices?.[model]?.outputPerMillion;
		if (settings.maxCostUsd === undefined || !outputPrice || outputPrice <= 0) {
			return configuredLimit;
		}
		const costLimit = Math.max(1, Math.floor(settings.maxCostUsd * 1_000_000 / outputPrice));
		return configuredLimit === undefined ? costLimit : Math.min(configuredLimit, costLimit);
	}

	private bucket(value: string): number {
		let hash = 2_166_136_261;
		for (const character of value) {
			hash ^= character.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 16_777_619);
		}
		return (hash >>> 0) % 100;
	}
}
