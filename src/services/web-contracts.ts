export const DEFAULT_KAGI_BASE_URL = 'https://kagi.com/api/v1';

export const WEB_TOOL_NAMES = ['search_web', 'summarize_web_page'] as const;
export type WebToolName = typeof WEB_TOOL_NAMES[number];

export type WebSource = {
	url: string;
	title: string;
	snippet?: string;
	publishedAt?: string;
};

export type WebSearchResult = {
	available: boolean;
	sources: WebSource[];
	reason?: string;
};

export type WebExtractResult = {
	available: boolean;
	url: string;
	content?: string;
	title?: string;
	reason?: string;
};

export type WebRequestStateOptions = {
	userSnowflake: string;
	signal?: AbortSignal;
	maxToolRounds: number;
	maxUpstreamCalls: number;
};

/** Mutable state shared by every web tool call in one top-level chat request. */
export class WebRequestState {
	public round = 0;
	public upstreamCalls = 0;
	public attempted = false;
	public successful = false;
	public fallback = false;
	public webAvailable = true;
	public readonly sources = new Map<string, WebSource>();

	public readonly userSnowflake: string;
	public readonly signal?: AbortSignal;
	public readonly maxToolRounds: number;
	public readonly maxUpstreamCalls: number;

	public constructor(options: WebRequestStateOptions) {
		this.userSnowflake = options.userSnowflake;
		this.signal = options.signal;
		this.maxToolRounds = Math.max(0, Math.floor(options.maxToolRounds));
		this.maxUpstreamCalls = Math.max(0, Math.floor(options.maxUpstreamCalls));
	}

	public reserveUpstreamCall(): boolean {
		if (this.upstreamCalls >= this.maxUpstreamCalls) {
			return false;
		}
		this.upstreamCalls += 1;
		this.attempted = true;
		return true;
	}

	public canReserveUpstreamCall(): boolean {
		return this.upstreamCalls < this.maxUpstreamCalls;
	}

	public addSources(sources: WebSource[]): void {
		for (const source of sources) {
			if (!this.sources.has(source.url)) {
				this.sources.set(source.url, source);
			}
		}
		if (sources.length > 0) {
			this.successful = true;
		}
	}

	public blockWeb(): void {
		this.webAvailable = false;
	}

	public markFallback(): void {
		this.fallback = true;
	}

	public provenance(): WebProvenance {
		return {
			attempted: this.attempted,
			used: this.successful && !this.fallback,
			fallback: this.fallback,
			sources: [...this.sources.values()],
		};
	}
}

export type WebProvenance = {
	attempted: boolean;
	used: boolean;
	fallback: boolean;
	sources: WebSource[];
};

export type KagiConfig = {
	enabled: boolean;
	apiKey: string;
	baseUrl: string;
	maxResults: number;
	maxExtractChars: number;
	cacheEntries: number;
	cacheTtlMs: number;
	maxToolRounds: number;
	maxUpstreamCallsPerMessage: number;
	maxCallsPerUserPerHour: number;
	requestTimeoutMs: number;
};

export type ModerationConfig = {
	enabled: boolean;
	model: 'omni-moderation-latest' | 'omni-moderation-2024-09-26' | 'text-moderation-latest' | 'text-moderation-stable';
	timeoutMs: number;
};

export type WebTelemetryEvent = {
	type: 'cache_hit' | 'upstream_call' | 'quota_denied' | 'provider_error' | 'moderation_failure';
	provider?: 'kagi' | 'openai';
	operation?: 'search' | 'extract' | 'moderate';
	status?: number;
	latencyMs?: number;
};

export type WebTelemetry = (event: WebTelemetryEvent) => void;
