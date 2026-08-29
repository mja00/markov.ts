import { lookup } from 'node:dns/promises';
import net from 'node:net';

import fetch, { RequestInit, Response } from 'node-fetch';

import {
	DEFAULT_KAGI_BASE_URL,
	KagiConfig,
	WebExtractResult,
	WebRequestState,
	WebSearchResult,
	WebSource,
	WebTelemetry,
} from './web-contracts.js';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type HostResolver = (hostname: string) => Promise<string[]>;

type CacheEntry<T> = {
	value: T;
	expiresAt: number;
};

type InFlight<T> = {
	controller: AbortController;
	waiters: number;
	settled: boolean;
	promise: Promise<T>;
};

export type KagiServiceOptions = {
	config: KagiConfig;
	fetcher?: Fetcher;
	now?: () => number;
	resolveHostnames?: HostResolver;
	telemetry?: WebTelemetry;
};

const MAX_QUERY_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 500;
const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 2_000_000;
const USER_CALL_SWEEP_SIZE = 1000;

const textValue = (value: unknown): string | undefined => (
	typeof value === 'string' && value.trim() ? value.trim() : undefined
);

const truncate = (value: string, length: number): string => value.slice(0, length);

const hasControlCharacters = (value: string): boolean => {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code <= 0x1F || code === 0x7F) {
			return true;
		}
	}
	return false;
};

const isPrivateIpv4 = (address: string): boolean => {
	const octets = address.split('.').map(Number);
	if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return true;
	}
	const [first, second] = octets;
	return first === 0
		|| first === 10
		|| first === 127
		|| (first === 100 && second >= 64 && second <= 127)
		|| (first === 169 && second === 254)
		|| (first === 172 && second >= 16 && second <= 31)
		|| (first === 192 && second === 168)
		|| (first === 192 && second === 0)
		|| (first === 198 && (second === 18 || second === 19))
		|| first >= 224;
};

const isPrivateAddress = (address: string): boolean => {
	const normalized = address.toLowerCase();
	if (net.isIPv4(normalized)) {
		return isPrivateIpv4(normalized);
	}
	if (!net.isIPv6(normalized)) {
		return true;
	}
	return normalized === '::'
		|| normalized === '::1'
		|| normalized.startsWith('::')
		|| normalized.startsWith('fc')
		|| normalized.startsWith('fd')
		|| normalized.startsWith('fe8')
		|| normalized.startsWith('fe9')
		|| normalized.startsWith('fea')
		|| normalized.startsWith('feb')
		|| normalized.startsWith('ff')
		|| normalized.startsWith('::ffff:');
};

const defaultResolver: HostResolver = async (hostname) => {
	if (net.isIP(hostname)) {
		return [hostname];
	}
	const results = await lookup(hostname, { all: true });
	return results.map(result => result.address);
};

const canonicalizeUrl = (value: string, requireHttps: boolean): string | null => {
	if (hasControlCharacters(value)) {
		return null;
	}
	try {
		const parsed = new URL(value);
		if ((requireHttps && parsed.protocol !== 'https:') || (!requireHttps && !['http:', 'https:'].includes(parsed.protocol))) {
			return null;
		}
		if (!parsed.hostname || parsed.username || parsed.password || parsed.port === '0' || parsed.toString().length > MAX_SOURCE_URL_LENGTH) {
			return null;
		}
		parsed.hash = '';
		const canonical = parsed.toString();
		return canonical.length <= MAX_SOURCE_URL_LENGTH ? canonical : null;
	} catch {
		return null;
	}
};

const unavailableSearch = (reason: string): WebSearchResult => { return { available: false, sources: [], reason }; };
const unavailableExtract = (url: string, reason: string): WebExtractResult => { return { available: false, url, reason }; };

export class KagiService {
	private readonly config: KagiConfig;
	private readonly fetcher: Fetcher;
	private readonly now: () => number;
	private readonly resolveHostnames: HostResolver;
	private readonly telemetry?: WebTelemetry;
	private readonly searchCache = new Map<string, CacheEntry<WebSearchResult>>();
	private readonly extractCache = new Map<string, CacheEntry<WebExtractResult>>();
	private readonly searchInFlight = new Map<string, InFlight<WebSearchResult>>();
	private readonly extractInFlight = new Map<string, InFlight<WebExtractResult>>();
	private readonly userCalls = new Map<string, number[]>();

	public constructor(options: KagiServiceOptions) {
		this.config = {
			...options.config,
			apiKey: typeof options.config.apiKey === 'string' ? options.config.apiKey.trim() : '',
			baseUrl: (options.config.baseUrl || DEFAULT_KAGI_BASE_URL).replaceAll(/\/+$/gu, ''),
		};
		this.fetcher = options.fetcher ?? fetch;
		this.now = options.now ?? Date.now;
		this.resolveHostnames = options.resolveHostnames ?? defaultResolver;
		this.telemetry = options.telemetry;
	}

	public get requestLimits(): { maxToolRounds: number; maxUpstreamCallsPerMessage: number; } {
		return {
			maxToolRounds: this.config.maxToolRounds,
			maxUpstreamCallsPerMessage: this.config.maxUpstreamCallsPerMessage,
		};
	}

	public async search(query: string, state?: WebRequestState): Promise<WebSearchResult> {
		const normalizedQuery = query.trim();
		if (!this.config.enabled || !state || !state.webAvailable) {
			return unavailableSearch('Web search is unavailable.');
		}
		if (!normalizedQuery || normalizedQuery.length > MAX_QUERY_LENGTH || hasControlCharacters(normalizedQuery)) {
			state.blockWeb();
			return unavailableSearch('The search query is empty or too long.');
		}

		const key = `${this.config.baseUrl}:search:${this.config.maxResults}:${normalizedQuery.toLowerCase()}`;
		const cached = this.getCached(this.searchCache, key);
		if (cached) {
			this.telemetry?.({ type: 'cache_hit', provider: 'kagi', operation: 'search' });
			state.addSources(cached.sources);
			return cached;
		}

		const existing = this.searchInFlight.get(key);
		if (existing) {
			const result = await this.join(existing, state.signal);
			if (!result.available) {
				state.blockWeb();
			}
			state.addSources(result.sources);
			return result;
		}

		if (!state.canReserveUpstreamCall() || !this.reserveUserCall(state.userSnowflake)) {
			state.blockWeb();
			this.telemetry?.({ type: 'quota_denied', provider: 'kagi', operation: 'search' });
			return unavailableSearch('The web-search limit for this request has been reached.');
		}
		state.reserveUpstreamCall();

		const entry = this.createInFlight(this.searchInFlight, key, signal => this.requestSearch(normalizedQuery, signal));
		const result = await this.join(entry, state.signal);
		if (!result.available) {
			state.blockWeb();
		}
		if (result.available) {
			this.setCached(this.searchCache, key, result);
			state.addSources(result.sources);
		}
		return result;
	}

	public async extract(url: string, state?: WebRequestState): Promise<WebExtractResult> {
		const canonicalUrl = canonicalizeUrl(url.trim(), true);
		if (!canonicalUrl) {
			return unavailableExtract(url, 'Only public HTTPS URLs can be summarized.');
		}
		if (!this.config.enabled || !state || !state.webAvailable) {
			return unavailableExtract(canonicalUrl, 'Web extraction is unavailable.');
		}
		if (!(await this.isPublicHost(canonicalUrl))) {
			state.blockWeb();
			return unavailableExtract(canonicalUrl, 'That URL is not a permitted public destination.');
		}

		const key = `${this.config.baseUrl}:extract:${this.config.maxExtractChars}:${canonicalUrl}`;
		const cached = this.getCached(this.extractCache, key);
		if (cached) {
			this.telemetry?.({ type: 'cache_hit', provider: 'kagi', operation: 'extract' });
			if (cached.available) {
				state.addSources([{ url: canonicalUrl, title: cached.title ?? new URL(canonicalUrl).hostname }]);
			}
			return cached;
		}

		const existing = this.extractInFlight.get(key);
		if (existing) {
			const result = await this.join(existing, state.signal);
			if (!result.available) {
				state.blockWeb();
			} else {
				state.addSources([{ url: canonicalUrl, title: result.title ?? new URL(canonicalUrl).hostname }]);
			}
			return result;
		}

		if (!state.canReserveUpstreamCall() || !this.reserveUserCall(state.userSnowflake)) {
			state.blockWeb();
			this.telemetry?.({ type: 'quota_denied', provider: 'kagi', operation: 'extract' });
			return unavailableExtract(canonicalUrl, 'The web-search limit for this request has been reached.');
		}
		state.reserveUpstreamCall();

		const entry = this.createInFlight(this.extractInFlight, key, signal => this.requestExtract(canonicalUrl, signal));
		const result = await this.join(entry, state.signal);
		if (!result.available) {
			state.blockWeb();
		}
		if (result.available) {
			this.setCached(this.extractCache, key, result);
			state.addSources([{ url: canonicalUrl, title: result.title ?? new URL(canonicalUrl).hostname }]);
		}
		return result;
	}

	private async requestSearch(query: string, signal: AbortSignal): Promise<WebSearchResult> {
		const startedAt = this.now();
		try {
			const response = await this.fetchWithTimeout(`${this.config.baseUrl}/search`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.config.apiKey}`,
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					query,
					workflow: 'search',
					format: 'json',
					safe_search: true,
					limit: this.config.maxResults,
				}),
			}, signal);
			if (!response.ok) {
				this.telemetry?.({ type: 'provider_error', provider: 'kagi', operation: 'search', status: response.status, latencyMs: this.now() - startedAt });
				return unavailableSearch('Kagi could not complete that search.');
			}
			const payload = await this.readJson(response);
			const sources = this.parseSearchSources(payload);
			this.telemetry?.({ type: 'upstream_call', provider: 'kagi', operation: 'search', latencyMs: this.now() - startedAt });
			return { available: true, sources };
		} catch (error) {
			this.telemetry?.({ type: 'provider_error', provider: 'kagi', operation: 'search', latencyMs: this.now() - startedAt });
			if (signal.aborted) {
				throw error;
			}
			return unavailableSearch('Kagi could not complete that search.');
		}
	}

	private async requestExtract(url: string, signal: AbortSignal): Promise<WebExtractResult> {
		const startedAt = this.now();
		try {
			const response = await this.fetchWithTimeout(`${this.config.baseUrl}/extract`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.config.apiKey}`,
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					pages: [{ url }],
					format: 'json',
					timeout: Math.max(1, this.config.requestTimeoutMs / 1000),
				}),
			}, signal);
			if (!response.ok) {
				this.telemetry?.({ type: 'provider_error', provider: 'kagi', operation: 'extract', status: response.status, latencyMs: this.now() - startedAt });
				return unavailableExtract(url, 'Kagi could not extract that page.');
			}
			const payload = await this.readJson(response);
			const page = this.parseExtractPage(payload, url);
			this.telemetry?.({ type: 'upstream_call', provider: 'kagi', operation: 'extract', latencyMs: this.now() - startedAt });
			return page;
		} catch (error) {
			this.telemetry?.({ type: 'provider_error', provider: 'kagi', operation: 'extract', latencyMs: this.now() - startedAt });
			if (signal.aborted) {
				throw error;
			}
			return unavailableExtract(url, 'Kagi could not extract that page.');
		}
	}

	private async fetchWithTimeout(url: string, init: RequestInit, upstreamSignal: AbortSignal): Promise<Response> {
		const controller = new AbortController();
		const abortFromUpstream = () => controller.abort(upstreamSignal.reason);
		if (upstreamSignal.aborted) {
			abortFromUpstream();
		} else {
			upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
		}
		const timer = setTimeout(() => controller.abort(new Error('Kagi request timed out.')), this.config.requestTimeoutMs);
		try {
			return await this.fetcher(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timer);
			upstreamSignal.removeEventListener('abort', abortFromUpstream);
		}
	}

	private parseSearchSources(payload: unknown): WebSource[] {
		const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
		const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : {};
		let results: unknown[] = [];
		if (Array.isArray(data.search)) {
			results = data.search;
		} else if (Array.isArray(data.results)) {
			results = data.results;
		} else if (Array.isArray(root.data)) {
			results = root.data;
		}
		const sources: WebSource[] = [];
		for (const value of results) {
			if (!value || typeof value !== 'object') {
				continue;
			}
			const result = value as Record<string, unknown>;
			const url = textValue(result.url);
			const title = textValue(result.title) ?? textValue(result.name);
			if (!url || !title) {
				continue;
			}
			const canonicalUrl = canonicalizeUrl(url, false);
			if (!canonicalUrl) {
				continue;
			}
			const source: WebSource = {
				url: canonicalUrl,
				title: truncate(title, MAX_TITLE_LENGTH),
			};
			const snippet = textValue(result.snippet) ?? textValue(result.description);
			if (snippet) {
				source.snippet = truncate(snippet, MAX_SNIPPET_LENGTH);
			}
			const publishedAt = textValue(result.time) ?? textValue(result.published);
			if (publishedAt) {
				source.publishedAt = truncate(publishedAt, 80);
			}
			if (!sources.some(existing => existing.url === source.url)) {
				sources.push(source);
			}
			if (sources.length >= this.config.maxResults) {
				break;
			}
		}
		return sources;
	}

	private parseExtractPage(payload: unknown, requestedUrl: string): WebExtractResult {
		const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
		const data = Array.isArray(root.data)
			? root.data
			: (root.data && typeof root.data === 'object' && Array.isArray((root.data as Record<string, unknown>).pages)
				? (root.data as Record<string, unknown>).pages as unknown[]
				: []);
		const page = data.find(value => value && typeof value === 'object' && (value as Record<string, unknown>).url === requestedUrl) ?? data[0];
		if (!page || typeof page !== 'object') {
			return unavailableExtract(requestedUrl, 'Kagi returned no page content.');
		}
		const record = page as Record<string, unknown>;
		const returnedUrl = textValue(record.url);
		const pageUrl = returnedUrl ? (canonicalizeUrl(returnedUrl, true) ?? requestedUrl) : requestedUrl;
		const markdown = textValue(record.markdown);
		if (!markdown) {
			return unavailableExtract(pageUrl, 'Kagi could not extract that page.');
		}
		const title = textValue(record.title);
		return {
			available: true,
			url: pageUrl,
			content: truncate(markdown, this.config.maxExtractChars),
			...(title ? { title: truncate(title, MAX_TITLE_LENGTH) } : {}),
		};
	}

	private async readJson(response: Response): Promise<unknown> {
		// Reject on the declared size first so an oversized body is never buffered.
		const declaredBytes = Number(response.headers?.get('content-length') ?? 0);
		if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RESPONSE_BYTES) {
			throw new Error('Kagi response exceeded the configured safety limit.');
		}
		const body = await response.text();
		if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
			throw new Error('Kagi response exceeded the configured safety limit.');
		}
		return JSON.parse(body) as unknown;
	}

	private async isPublicHost(value: string): Promise<boolean> {
		const hostname = new URL(value).hostname.replaceAll(/^\[|\]$/gu, '').toLowerCase();
		if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
			return false;
		}
		try {
			const addresses = await this.resolveHostnames(hostname);
			return addresses.length > 0 && addresses.every(address => !isPrivateAddress(address));
		} catch {
			return false;
		}
	}

	private reserveUserCall(userSnowflake: string): boolean {
		const now = this.now();
		const cutoff = now - 3_600_000;
		// Entries only expire when their own user calls again, so sweep once the map grows.
		if (this.userCalls.size > USER_CALL_SWEEP_SIZE) {
			for (const [snowflake, timestamps] of this.userCalls) {
				if (timestamps.every(timestamp => timestamp <= cutoff)) {
					this.userCalls.delete(snowflake);
				}
			}
		}
		const calls = (this.userCalls.get(userSnowflake) ?? []).filter(timestamp => timestamp > cutoff);
		if (calls.length >= this.config.maxCallsPerUserPerHour) {
			this.userCalls.set(userSnowflake, calls);
			return false;
		}
		calls.push(now);
		this.userCalls.set(userSnowflake, calls);
		return true;
	}

	private getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
		const entry = cache.get(key);
		if (!entry) {
			return undefined;
		}
		if (entry.expiresAt <= this.now()) {
			cache.delete(key);
			return undefined;
		}
		cache.delete(key);
		cache.set(key, entry);
		return entry.value;
	}

	private setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
		cache.delete(key);
		cache.set(key, { value, expiresAt: this.now() + this.config.cacheTtlMs });
		while (cache.size > this.config.cacheEntries) {
			const oldest = cache.keys().next().value as string | undefined;
			if (!oldest) {
				break;
			}
			cache.delete(oldest);
		}
	}

	private createInFlight<T>(
		map: Map<string, InFlight<T>>,
		key: string,
		request: (signal: AbortSignal) => Promise<T>,
	): InFlight<T> {
		const controller = new AbortController();
		const entry = {
			controller,
			waiters: 0,
			settled: false,
			promise: request(controller.signal),
		} as InFlight<T>;
		map.set(key, entry);
		void entry.promise.then(() => {
			entry.settled = true;
			if (map.get(key) === entry) {
				map.delete(key);
			}
		}, () => {
			entry.settled = true;
			if (map.get(key) === entry) {
				map.delete(key);
			}
		});
		return entry;
	}

	private async join<T>(entry: InFlight<T>, signal?: AbortSignal): Promise<T> {
		entry.waiters += 1;
		let released = false;
		const release = () => {
			if (released) {
				return;
			}
			released = true;
			entry.waiters -= 1;
			if (entry.waiters === 0 && !entry.settled) {
				entry.controller.abort();
			}
		};
		if (!signal) {
			try {
				return await entry.promise;
			} finally {
				release();
			}
		}
		if (signal.aborted) {
			release();
			signal.throwIfAborted();
		}
		try {
			return await Promise.race([
				entry.promise,
				new Promise<T>((_resolve, reject) => {
					const onAbort = () => reject(signal.reason ?? new Error('The request was aborted.'));
					signal.addEventListener('abort', onAbort, { once: true });
					void entry.promise.then(
						() => signal.removeEventListener('abort', onAbort),
						() => signal.removeEventListener('abort', onAbort),
					);
				}),
			]);
		} finally {
			release();
		}
	}
}
