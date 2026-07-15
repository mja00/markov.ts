import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

vi.mock('../../../src/services/logger.js', () => {
	return { Logger: { info: vi.fn() } };
});

import { InMemoryModelTelemetrySink, ModelRouter } from '../../../src/services/model-router.js';

describe('ModelRouter', () => {
	it('preserves the baseline when routing is disabled', () => {
		const router = new ModelRouter({
			enabled: false,
			tasks: { final_response: { model: 'candidate' } },
		});

		expect(router.route('final_response', 'baseline', 'channel-1')).toMatchObject({
			model: 'baseline',
			routed: false,
			maxOutputTokens: undefined,
		});
	});

	it('assigns rollout buckets deterministically', () => {
		const router = new ModelRouter({
			enabled: true,
			rolloutPercent: 50,
			tasks: { final_response: { model: 'candidate' } },
		});

		const first = router.route('final_response', 'baseline', 'stable-channel');
		for (let index = 0; index < 20; index++) {
			expect(router.route('final_response', 'baseline', 'stable-channel')).toEqual(first);
		}
	});

	it('enforces token and estimated output-cost limits', () => {
		const router = new ModelRouter({
			enabled: true,
			prices: { candidate: { inputPerMillion: 1, outputPerMillion: 20 } },
			tasks: {
				final_response: { model: 'candidate', maxOutputTokens: 1000, maxCostUsd: 0.01 },
			},
		});

		expect(router.route('final_response', 'baseline').maxOutputTokens).toBe(500);
	});

	it('records usage, tool calls, latency, and cost', async () => {
		const sink = new InMemoryModelTelemetrySink();
		const router = new ModelRouter({
			enabled: true,
			prices: { candidate: { inputPerMillion: 1, outputPerMillion: 2 } },
			tasks: { tool_selection: { model: 'candidate' } },
		}, sink);

		await router.execute('tool_selection', 'baseline', 'channel', async () => {
			return {
				usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
				output: [{ type: 'function_call', name: 'fish' }],
			};
		});

		expect(sink.events).toHaveLength(1);
		expect(sink.events[0]).toMatchObject({
			model: 'candidate',
			success: true,
			toolCalls: ['fish'],
			estimatedCostUsd: 0.002,
		});
	});

	it('falls back once and records both attempts', async () => {
		const sink = new InMemoryModelTelemetrySink();
		const router = new ModelRouter({
			enabled: true,
			tasks: { final_response: { model: 'candidate', fallbackModel: 'baseline' } },
		}, sink);
		const call = vi.fn(async (route: { model: string; }) => {
			if (route.model === 'candidate') {
				throw new Error('candidate unavailable');
			}
			return { output: [] };
		});

		await router.execute('final_response', 'original', 'channel', call);

		expect(call).toHaveBeenCalledTimes(2);
		expect(sink.events.map((event) => {
			return { model: event.model, success: event.success, fallbackFrom: event.fallbackFrom };
		})).toEqual([
			{ model: 'candidate', success: false, fallbackFrom: undefined },
			{ model: 'baseline', success: true, fallbackFrom: 'candidate' },
		]);
	});
});
