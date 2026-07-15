import {
	DMChannel,
	GuildChannel,
	GuildMember,
	PermissionFlagsBits,
	ThreadChannel,
} from 'discord.js';
import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { PermissionUtils } from '../../../src/utils/permission-utils.js';

const member = {} as GuildMember;

// Real discord.js channels need a client; prototype-based stubs satisfy the
// instanceof checks while letting us control permissionsFor directly.
function makeChannel<T>(prototype: object, permissionsFor: unknown): T {
	return Object.assign(Object.create(prototype), { permissionsFor }) as T;
}

describe('PermissionUtils.memberCanSend', () => {
	it('always allows DM channels', () => {
		const channel = Object.create(DMChannel.prototype) as DMChannel;
		expect(PermissionUtils.memberCanSend(channel, member)).toBe(true);
	});

	it('denies when member permissions cannot be resolved', () => {
		const channel = makeChannel<GuildChannel>(GuildChannel.prototype, vi.fn(() => null));
		expect(PermissionUtils.memberCanSend(channel, member)).toBe(false);
	});

	it('requires ViewChannel and SendMessages in guild channels', () => {
		const has = vi.fn().mockReturnValue(true);
		const channel = makeChannel<GuildChannel>(GuildChannel.prototype, vi.fn(() => { return { has }; }));

		expect(PermissionUtils.memberCanSend(channel, member)).toBe(true);
		expect(has).toHaveBeenCalledWith([
			PermissionFlagsBits.ViewChannel,
			PermissionFlagsBits.SendMessages,
		]);
	});

	it('requires SendMessagesInThreads in threads', () => {
		const has = vi.fn().mockReturnValue(false);
		const channel = makeChannel<ThreadChannel>(ThreadChannel.prototype, vi.fn(() => { return { has }; }));

		expect(PermissionUtils.memberCanSend(channel, member)).toBe(false);
		expect(has).toHaveBeenCalledWith([
			PermissionFlagsBits.ViewChannel,
			PermissionFlagsBits.SendMessagesInThreads,
		]);
	});

	it('denies unsupported channel types', () => {
		expect(PermissionUtils.memberCanSend({} as never, member)).toBe(false);
	});
});
