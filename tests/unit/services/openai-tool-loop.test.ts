import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { OpenAIService, RequestContext } from '../../../src/services/openai.js';
import { ReplyBudget } from '../../../src/services/reply-budget.js';
import { WebRequestState } from '../../../src/services/web-contracts.js';

import type OpenAI from 'openai';

const response = (id: string, output: unknown[], outputTokens = 0): OpenAI.Responses.Response => ({
	id,
	output,
	usage: { output_tokens: outputTokens },
} as unknown as OpenAI.Responses.Response);

const rollCall = (callId: string) => {
	return {
		type: 'function_call', name: 'random_number_generator', call_id: callId, arguments: '{"min":1,"max":6}',
	};
};

const answer = (id: string, text: string) => response(id, [{
	type: 'message',
	content: [{ type: 'output_text', text }],
}]);

const budget = (overrides: Partial<ReplyBudget> = {}): ReplyBudget => {
	return {
		maxToolRounds: 6,
		maxOutputTokens: 20000,
		wrapUpAfterMs: 75000,
		timeoutMs: 120000,
		...overrides,
	};
};

const context = (overrides: Partial<RequestContext> = {}): RequestContext => {
	return {
		channelId: 'channel',
		userSnowflake: 'user-1',
		guildSnowflake: 'guild',
		username: 'Alice',
		startedAt: Date.now(),
		...overrides,
	};
};

const toolNames = (params: OpenAI.Responses.ResponseCreateParams): string[] => (
	(params.tools ?? []).flatMap(tool => ('name' in tool ? [tool.name] : []))
);

const runLoop = (service: OpenAIService, initial: OpenAI.Responses.Response, ctx: RequestContext): Promise<OpenAI.Responses.Response> => {
	// The loop is private; driving it directly avoids standing up the conversation store.
	const internals = service as unknown as {
		processResponseWithFunctionCalls: (value: OpenAI.Responses.Response, config: OpenAI.Responses.ResponseCreateParams, ctx: RequestContext) => Promise<OpenAI.Responses.Response>;
	};
	return internals.processResponseWithFunctionCalls.call(service, initial, { model: 'gpt-5.4', instructions: 'test', store: true }, ctx);
};

describe('OpenAI reply budget', () => {
	it('chains tool rounds until the model answers', async () => {
		const responseCreate = vi.fn()
			.mockResolvedValueOnce(response('round-2', [rollCall('call-2')]))
			.mockResolvedValueOnce(answer('final', 'Rolled twice.'));
		const service = OpenAIService.createForTest({ responseCreate, replyBudget: budget() });

		const result = await runLoop(service, response('initial', [rollCall('call-1')]), context());

		expect(result.id).toBe('final');
		expect(responseCreate).toHaveBeenCalledTimes(2);
		const secondRequest = responseCreate.mock.calls[1][0];
		expect(secondRequest.previous_response_id).toBe('round-2');
		expect(secondRequest.input).toEqual([expect.objectContaining({ type: 'function_call_output', call_id: 'call-2' })]);
		expect(secondRequest.tool_choice).toBeUndefined();
	});

	it('forces a tool-free reply on the last allowed round', async () => {
		const responseCreate = vi.fn()
			.mockResolvedValueOnce(response('round-2', [rollCall('call-2')]))
			.mockResolvedValueOnce(answer('final', 'Out of rolls.'));
		const service = OpenAIService.createForTest({ responseCreate, replyBudget: budget({ maxToolRounds: 2 }) });

		const result = await runLoop(service, response('initial', [rollCall('call-1')]), context());

		expect(result.id).toBe('final');
		expect(responseCreate).toHaveBeenCalledTimes(2);
		const lastRequest = responseCreate.mock.calls[1][0];
		expect(lastRequest.tools).toEqual([]);
		expect(lastRequest.tool_choice).toBe('none');
		// The pending call still runs so the final answer can use its result.
		expect(lastRequest.input[0]).toEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'call-2' }));
		expect(lastRequest.input.at(-1)).toEqual(expect.objectContaining({ type: 'message', role: 'developer' }));
	});

	it('wraps up once the output token budget is spent', async () => {
		const responseCreate = vi.fn().mockResolvedValueOnce(answer('final', 'Done thinking.'));
		const service = OpenAIService.createForTest({ responseCreate, replyBudget: budget({ maxOutputTokens: 1000 }) });

		await runLoop(service, response('initial', [rollCall('call-1')], 1000), context());

		expect(responseCreate).toHaveBeenCalledTimes(1);
		expect(responseCreate.mock.calls[0][0].tool_choice).toBe('none');
	});

	it('wraps up once the reply has run past wrapUpAfterMs', async () => {
		const responseCreate = vi.fn().mockResolvedValueOnce(answer('final', 'Sorry for the wait.'));
		const service = OpenAIService.createForTest({ responseCreate, replyBudget: budget({ wrapUpAfterMs: 5000 }) });

		await runLoop(service, response('initial', [rollCall('call-1')]), context({ startedAt: Date.now() - 6000 }));

		expect(responseCreate.mock.calls[0][0].tool_choice).toBe('none');
	});

	it('keeps action and web tools available until web content is read', async () => {
		const responseCreate = vi.fn().mockResolvedValueOnce(answer('final', 'Rolled a die.'));
		const service = OpenAIService.createForTest({ kagiService: { search: vi.fn() } as never, responseCreate, replyBudget: budget() });

		await runLoop(service, response('initial', [rollCall('call-1')]), context({
			web: new WebRequestState({ userSnowflake: 'user-1', maxToolRounds: 3, maxUpstreamCalls: 3 }),
		}));

		const names = toolNames(responseCreate.mock.calls[0][0]);
		expect(names).toContain('schedule_message');
		expect(names).toContain('search_web');
	});

	it('keeps action tools after a web call that returned no content', async () => {
		const search = vi.fn(async (_query: string, requestState?: WebRequestState) => {
			requestState?.blockWeb();
			return { available: false, sources: [], reason: 'Kagi is down.' };
		});
		const responseCreate = vi.fn().mockResolvedValueOnce(answer('final', 'Search is down, but I set the reminder.'));
		const service = OpenAIService.createForTest({ kagiService: { search } as never, responseCreate, replyBudget: budget() });

		await runLoop(service, response('initial', [{
			type: 'function_call', name: 'search_web', call_id: 'call-1', arguments: '{"query":"news"}',
		}]), context({
			web: new WebRequestState({ userSnowflake: 'user-1', maxToolRounds: 3, maxUpstreamCalls: 3 }),
		}));

		expect(search).toHaveBeenCalledTimes(1);
		const names = toolNames(responseCreate.mock.calls[0][0]);
		expect(names).toContain('schedule_message');
		expect(names).not.toContain('search_web');
	});

	it('stops offering web tools after the web round cap but keeps the loop going', async () => {
		const search = vi.fn(async (_query: string, requestState?: WebRequestState) => {
			requestState?.reserveUpstreamCall();
			requestState?.addSources([{ url: 'https://example.com', title: 'Example' }]);
			return { available: true, sources: [{ url: 'https://example.com', title: 'Example' }] };
		});
		const responseCreate = vi.fn()
			.mockResolvedValueOnce(response('round-2', [{
				type: 'function_call', name: 'search_web', call_id: 'call-2', arguments: '{"query":"again"}',
			}]))
			.mockResolvedValueOnce(answer('final', 'One search was enough.'));
		const service = OpenAIService.createForTest({ kagiService: { search } as never, responseCreate, replyBudget: budget() });

		const result = await runLoop(service, response('initial', [{
			type: 'function_call', name: 'search_web', call_id: 'call-1', arguments: '{"query":"first"}',
		}]), context({
			web: new WebRequestState({ userSnowflake: 'user-1', maxToolRounds: 1, maxUpstreamCalls: 3 }),
		}));

		expect(result.id).toBe('final');
		expect(search).toHaveBeenCalledTimes(1);
		expect(toolNames(responseCreate.mock.calls[0][0])).toEqual([]);
		expect(responseCreate.mock.calls[0][0].tool_choice).toBeUndefined();
		expect(responseCreate.mock.calls[1][0].input).toEqual([{
			type: 'function_call_output',
			call_id: 'call-2',
			output: 'Error: This tool is not available during web research.',
		}]);
	});
});
