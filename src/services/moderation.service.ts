import { createRequire } from 'node:module';

import OpenAI from 'openai';

import { ModerationConfig, WebTelemetry } from './web-contracts.js';

const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');

export type ModerationStatus = 'allowed' | 'flagged' | 'unavailable' | 'disabled';

export type ModerationResult = {
	status: ModerationStatus;
};

export type ModerationClient = {
	moderations: {
		create: (body: { model: string; input: string; }, options?: { timeout?: number; signal?: AbortSignal; }) => Promise<unknown>;
	};
};

export type ModerationServiceOptions = {
	config: ModerationConfig;
	client?: ModerationClient;
	telemetry?: WebTelemetry;
};

const defaultClient = (): ModerationClient => new OpenAI({ apiKey: Config.openai?.apiKey }) as unknown as ModerationClient;

export class ModerationService {
	private readonly config: ModerationConfig;
	private readonly client: ModerationClient;
	private readonly telemetry?: WebTelemetry;

	public constructor(options: ModerationServiceOptions) {
		this.config = options.config;
		this.client = options.client ?? defaultClient();
		this.telemetry = options.telemetry;
	}

	public get enabled(): boolean {
		return this.config.enabled;
	}

	public async moderate(text: string, signal?: AbortSignal): Promise<ModerationResult> {
		if (!this.config.enabled) {
			return { status: 'disabled' };
		}
		if (!text.trim()) {
			return { status: 'allowed' };
		}
		try {
			const response = await this.client.moderations.create({
				model: this.config.model,
				input: text,
			}, {
				timeout: this.config.timeoutMs,
				signal,
			});
			const firstResult = response && typeof response === 'object' && 'results' in response
				? (response as { results?: unknown; }).results
				: undefined;
			const flagged = Array.isArray(firstResult)
				&& firstResult[0]
				&& typeof firstResult[0] === 'object'
				&& 'flagged' in firstResult[0]
				&& typeof(firstResult[0] as { flagged?: unknown; }).flagged === 'boolean'
				? (firstResult[0] as { flagged: boolean; }).flagged
				: null;
			if (flagged === null) {
				this.telemetry?.({ type: 'moderation_failure', provider: 'openai', operation: 'moderate' });
				return { status: 'unavailable' };
			}
			return { status: flagged ? 'flagged' : 'allowed' };
		} catch {
			this.telemetry?.({ type: 'moderation_failure', provider: 'openai', operation: 'moderate' });
			return { status: 'unavailable' };
		}
	}
}
