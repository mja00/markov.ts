import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { OpenAIService } from '../../../src/services/openai.js';
import { WebRequestState } from '../../../src/services/web-contracts.js';

import type OpenAI from 'openai';

const response = (id: string, output: unknown[]): OpenAI.Responses.Response => ({
	id,
	output,
} as unknown as OpenAI.Responses.Response);

describe('OpenAI web orchestration', () => {
	it('runs a web tool round, exposes only allowed follow-up tools, and returns provenance', async () => {
		const search = vi.fn(async (_query: string, requestState?: WebRequestState) => {
			requestState?.reserveUpstreamCall();
			requestState?.addSources([{ url: 'https://example.com/article', title: 'Example article' }]);
			return { available: true, sources: [{ url: 'https://example.com/article', title: 'Example article' }] };
		});
		const responseCreate = vi.fn(async (params: OpenAI.Responses.ResponseCreateParams) => {
			expect(params.previous_response_id).toBe('initial');
			expect(params.tools?.some(tool => 'name' in tool && tool.name === 'search_web')).toBe(true);
			expect(params.tools?.some(tool => 'name' in tool && tool.name === 'schedule_message')).toBe(false);
			expect(params.tools?.some(tool => 'name' in tool && tool.name === 'fish')).toBe(false);
			expect(params.tools?.some(tool => tool.type === 'image_generation')).toBe(false);
			return response('final', [{
				type: 'message',
				content: [{ type: 'output_text', text: 'Here is the sourced answer.' }],
			}]);
		});
		const service = OpenAIService.createForTest({
			kagiService: { search } as never,
			responseCreate,
		});
		const requestState = new WebRequestState({ userSnowflake: 'user-1', maxToolRounds: 3, maxUpstreamCalls: 3 });
		const context = {
			channelId: 'channel',
			userSnowflake: 'user-1',
			guildSnowflake: 'guild',
			username: 'Alice',
			web: requestState,
		};
		const initial = response('initial', [{
			type: 'function_call',
			name: 'search_web',
			call_id: 'call-1',
			arguments: JSON.stringify({ query: 'latest news' }),
		}]);
		const process = (service as unknown as {
			processResponseWithFunctionCalls: (value: OpenAI.Responses.Response, config: OpenAI.Responses.ResponseCreateParams, ctx: typeof context) => Promise<OpenAI.Responses.Response>;
		}).processResponseWithFunctionCalls.bind(service);

		const result = await process(initial, { model: 'gpt-5.4', instructions: 'test', store: true }, context);
		const content = service.getResponseContentWithImages(result);

		expect(search).toHaveBeenCalledWith('latest news', requestState);
		expect(responseCreate).toHaveBeenCalledTimes(1);
		expect(content.text).toBe('Here is the sourced answer.');
		expect(content.web).toEqual({
			attempted: true,
			used: true,
			fallback: false,
			sources: [{ url: 'https://example.com/article', title: 'Example article' }],
		});
	});

	it('does not execute a tool call after the web round limit', async () => {
		const responseCreate = vi.fn();
		const search = vi.fn(async (_query: string, requestState?: WebRequestState) => {
			requestState?.reserveUpstreamCall();
			requestState?.addSources([{ url: 'https://example.com', title: 'Example' }]);
			return { available: true, sources: [{ url: 'https://example.com', title: 'Example' }] };
		});
		const service = OpenAIService.createForTest({ kagiService: { search } as never, responseCreate });
		const context = {
			channelId: 'channel',
			userSnowflake: 'user-1',
			guildSnowflake: 'guild',
			username: 'Alice',
			web: new WebRequestState({ userSnowflake: 'user-1', maxToolRounds: 0, maxUpstreamCalls: 1 }),
		};
		const initial = response('initial', [{
			type: 'function_call', name: 'search_web', call_id: 'call-1', arguments: '{"query":"query"}',
		}]);
		const process = (service as unknown as {
			processResponseWithFunctionCalls: (value: OpenAI.Responses.Response, config: OpenAI.Responses.ResponseCreateParams, ctx: typeof context) => Promise<OpenAI.Responses.Response>;
		}).processResponseWithFunctionCalls.bind(service);

		const result = await process(initial, { model: 'gpt-5.4', instructions: 'test', store: true }, context);

		expect(result).toBe(initial);
		expect(search).not.toHaveBeenCalled();
		expect(responseCreate).not.toHaveBeenCalled();
		expect(context.web.fallback).toBe(true);
	});

	it('blocks action tools returned by a web follow-up', async () => {
		const search = vi.fn(async (_query: string, requestState?: WebRequestState) => {
			requestState?.reserveUpstreamCall();
			requestState?.addSources([{ url: 'https://example.com', title: 'Example' }]);
			return { available: true, sources: [{ url: 'https://example.com', title: 'Example' }] };
		});
		const responseCreate = vi.fn()
			.mockResolvedValueOnce(response('injected', [{
				type: 'function_call',
				name: 'schedule_message',
				call_id: 'injected-call',
				arguments: JSON.stringify({ content: 'post this', delay_minutes: 1, run_at: null }),
			}]))
			.mockResolvedValueOnce(response('final', [{
				type: 'message',
				content: [{ type: 'output_text', text: 'Done.' }],
			}]));
		const service = OpenAIService.createForTest({ kagiService: { search } as never, responseCreate });
		const context = {
			channelId: 'channel',
			userSnowflake: 'user-1',
			guildSnowflake: 'guild',
			username: 'Alice',
			web: new WebRequestState({ userSnowflake: 'user-1', maxToolRounds: 3, maxUpstreamCalls: 2 }),
		};
		const initial = response('initial', [{
			type: 'function_call', name: 'search_web', call_id: 'call-1', arguments: '{"query":"query"}',
		}]);
		const process = (service as unknown as {
			processResponseWithFunctionCalls: (value: OpenAI.Responses.Response, config: OpenAI.Responses.ResponseCreateParams, ctx: typeof context) => Promise<OpenAI.Responses.Response>;
		}).processResponseWithFunctionCalls.bind(service);

		const result = await process(initial, { model: 'gpt-5.4', instructions: 'test', store: true }, context);

		expect(result.id).toBe('final');
		expect(responseCreate).toHaveBeenCalledTimes(2);
		expect(responseCreate.mock.calls[1][0].input).toEqual([{
			type: 'function_call_output',
			call_id: 'injected-call',
			output: 'Error: This tool is not available during web research.',
		}]);
	});
});
