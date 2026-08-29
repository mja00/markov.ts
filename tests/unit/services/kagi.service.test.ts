import { Response } from 'node-fetch';
import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { KagiService } from '../../../src/services/kagi.service.js';
import { WebRequestState } from '../../../src/services/web-contracts.js';

const config = (overrides: Partial<ConstructorParameters<typeof KagiService>[0]['config']> = {}) => {
	return {
		enabled: true,
		apiKey: 'kagi-test-key',
		baseUrl: 'https://kagi.test/api/v1',
		maxResults: 5,
		maxExtractChars: 12000,
		cacheEntries: 10,
		cacheTtlMs: 120000,
		maxToolRounds: 3,
		maxUpstreamCallsPerMessage: 3,
		maxCallsPerUserPerHour: 10,
		requestTimeoutMs: 10000,
		...overrides,
	};
};

const state = (userSnowflake = 'user-1', overrides: Partial<ConstructorParameters<typeof WebRequestState>[0]> = {}) => new WebRequestState({
	userSnowflake,
	maxToolRounds: 3,
	maxUpstreamCalls: 3,
	...overrides,
});

describe('KagiService', () => {
	it('posts a bounded search request, parses sources, and caches identical queries', async () => {
		const fetcher = vi.fn(async (_url: string, init?: { body?: string; headers?: Record<string, string>; }) => {
			expect(init?.headers?.Authorization).toBe('Bearer kagi-test-key');
			expect(JSON.parse(init?.body ?? '{}')).toMatchObject({
				query: 'latest markov release', workflow: 'search', format: 'json', safe_search: true, limit: 5,
			});
			return new Response(JSON.stringify({ data: { search: [{
				url: 'https://example.com/release#tracking',
				title: 'Latest release',
				snippet: 'Release details',
			}] } }), { status: 200 });
		});
		const service = new KagiService({ config: config(), fetcher });
		const request = state();

		await expect(service.search(' latest markov release ', request)).resolves.toEqual({
			available: true,
			sources: [{
				url: 'https://example.com/release',
				title: 'Latest release',
				snippet: 'Release details',
			}],
		});
		await service.search('latest markov release', request);

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(request.successful).toBe(true);
		expect(request.sources.size).toBe(1);
	});

	it('rejects private extraction destinations before making an upstream request', async () => {
		const fetcher = vi.fn();
		const service = new KagiService({
			config: config(),
			fetcher,
			resolveHostnames: async () => ['127.0.0.1'],
		});
		const request = state();

		await expect(service.extract('https://internal.example/secret', request)).resolves.toMatchObject({
			available: false,
			reason: 'That URL is not a permitted public destination.',
		});
		expect(fetcher).not.toHaveBeenCalled();
		expect(request.webAvailable).toBe(false);
	});

	it('extracts public pages with a content limit and records the page as a source', async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{
			url: 'https://example.com/article',
			markdown: 'A'.repeat(100),
		}] }), { status: 200 }));
		const service = new KagiService({
			config: config({ maxExtractChars: 20 }),
			fetcher,
			resolveHostnames: async () => ['93.184.216.34'],
		});
		const request = state();

		await expect(service.extract('https://example.com/article#fragment', request)).resolves.toMatchObject({
			available: true,
			url: 'https://example.com/article',
			content: 'A'.repeat(20),
		});
		expect([...request.sources.values()]).toEqual([{ url: 'https://example.com/article', title: 'example.com' }]);
	});

	it('enforces the per-user upstream quota across independent request states', async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { search: [] } }), { status: 200 }));
		const service = new KagiService({ config: config({ maxCallsPerUserPerHour: 1 }), fetcher });

		await service.search('first', state('same-user'));
		const second = state('same-user');
		await expect(service.search('second', second)).resolves.toMatchObject({ available: false });
		expect(second.webAvailable).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
