import { DEFAULT_KAGI_BASE_URL, KagiConfig, ModerationConfig } from './web-contracts.js';

const DEFAULT_KAGI_CONFIG = {
	maxResults: 5,
	maxExtractChars: 12000,
	cacheEntries: 256,
	cacheTtlMs: 120000,
	maxToolRounds: 3,
	maxUpstreamCallsPerMessage: 3,
	maxCallsPerUserPerHour: 10,
	requestTimeoutMs: 10000,
};

const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
	enabled: true,
	model: 'omni-moderation-latest',
	timeoutMs: 5000,
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => (
	value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
);

const boundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(maximum, Math.max(minimum, Math.floor(value)));
};

const boundedPositiveInteger = (value: unknown, fallback: number, maximum: number): number => (
	boundedInteger(value, fallback, 1, maximum)
);

const booleanValue = (value: unknown, fallback: boolean): boolean => (
	typeof value === 'boolean' ? value : fallback
);

export type ResolvedWebConfig = {
	kagi: KagiConfig | null;
	moderation: ModerationConfig;
	moderationConfigured: boolean;
};

export function resolveWebConfig(rawConfig: unknown, environment: NodeJS.ProcessEnv = process.env): ResolvedWebConfig {
	const root = asRecord(rawConfig);
	const rawKagi = asRecord(root.kagi);
	const rawModeration = asRecord(asRecord(root.moderation).webAssisted);
	const moderationConfigured = Object.keys(rawModeration).length > 0;

	const moderation: ModerationConfig = {
		enabled: moderationConfigured
			? booleanValue(rawModeration.enabled, DEFAULT_MODERATION_CONFIG.enabled)
			: false,
		model: rawModeration.model === 'omni-moderation-2024-09-26'
			|| rawModeration.model === 'text-moderation-latest'
			|| rawModeration.model === 'text-moderation-stable'
			? rawModeration.model
			: DEFAULT_MODERATION_CONFIG.model,
		timeoutMs: boundedPositiveInteger(rawModeration.timeoutMs, DEFAULT_MODERATION_CONFIG.timeoutMs, 60000),
	};

	const envEnabled = environment.KAGI_ENABLED?.trim().toLowerCase();
	const enabled = envEnabled === 'false'
		? false
		: (envEnabled === 'true'
			? true
			: booleanValue(rawKagi.enabled, false));
	const apiKey = environment.KAGI_API_KEY?.trim() || (typeof rawKagi.apiKey === 'string' ? rawKagi.apiKey.trim() : '');

	if (!enabled || !apiKey || !moderation.enabled) {
		return { kagi: null, moderation, moderationConfigured };
	}

	return {
		moderation,
		moderationConfigured,
		kagi: {
			enabled: true,
			apiKey,
			baseUrl: DEFAULT_KAGI_BASE_URL,
			maxResults: boundedPositiveInteger(rawKagi.maxResults, DEFAULT_KAGI_CONFIG.maxResults, 10),
			maxExtractChars: boundedPositiveInteger(rawKagi.maxExtractChars, DEFAULT_KAGI_CONFIG.maxExtractChars, 50000),
			cacheEntries: boundedPositiveInteger(rawKagi.cacheEntries, DEFAULT_KAGI_CONFIG.cacheEntries, 2000),
			cacheTtlMs: boundedPositiveInteger(
				typeof rawKagi.cacheTtlSeconds === 'number' ? rawKagi.cacheTtlSeconds * 1000 : undefined,
				DEFAULT_KAGI_CONFIG.cacheTtlMs,
				86_400_000,
			),
			maxToolRounds: boundedInteger(rawKagi.maxToolRounds, DEFAULT_KAGI_CONFIG.maxToolRounds, 0, 8),
			maxUpstreamCallsPerMessage: boundedInteger(
				rawKagi.maxUpstreamCallsPerMessage,
				DEFAULT_KAGI_CONFIG.maxUpstreamCallsPerMessage,
				0,
				20,
			),
			maxCallsPerUserPerHour: boundedInteger(
				rawKagi.maxCallsPerUserPerHour,
				DEFAULT_KAGI_CONFIG.maxCallsPerUserPerHour,
				0,
				1000,
			),
			requestTimeoutMs: boundedPositiveInteger(rawKagi.requestTimeoutMs, DEFAULT_KAGI_CONFIG.requestTimeoutMs, 120000),
		},
	};
}
