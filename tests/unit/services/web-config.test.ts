import { describe, expect, it } from 'vitest';

import { resolveWebConfig } from '../../../src/services/web-config.js';

describe('resolveWebConfig', () => {
	it('keeps web research disabled when moderation has not been configured', () => {
		const resolved = resolveWebConfig({
			kagi: { enabled: true, apiKey: 'config-key' },
		}, {});

		expect(resolved.kagi).toBeNull();
		expect(resolved.moderation.enabled).toBe(false);
		expect(resolved.moderationConfigured).toBe(false);
	});

	it('resolves Kagi settings only when the moderation gate is enabled', () => {
		const resolved = resolveWebConfig({
			kagi: {
				enabled: true,
				apiKey: 'config-key',
				maxResults: 99,
				maxExtractChars: 999999,
				maxToolRounds: 99,
				maxUpstreamCallsPerMessage: -1,
			},
			moderation: { webAssisted: { enabled: true, timeoutMs: 999999 } },
		}, {});

		expect(resolved.kagi).toMatchObject({
			enabled: true,
			apiKey: 'config-key',
			maxResults: 10,
			maxExtractChars: 50000,
			maxToolRounds: 8,
			maxUpstreamCallsPerMessage: 0,
			requestTimeoutMs: 10000,
		});
		expect(resolved.moderation).toMatchObject({ enabled: true, timeoutMs: 60000 });
	});

	it('allows environment secrets and an explicit kill switch to override config', () => {
		const base = {
			kagi: { enabled: true, apiKey: 'config-key' },
			moderation: { webAssisted: { enabled: true } },
		};

		expect(resolveWebConfig(base, { KAGI_API_KEY: ' env-key ' }).kagi?.apiKey).toBe('env-key');
		expect(resolveWebConfig(base, { KAGI_ENABLED: 'false', KAGI_API_KEY: 'env-key' }).kagi).toBeNull();
	});
});
