import { Collection } from 'discord.js';
import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

vi.mock('../../../src/services/logger.js', () => {
	return { Logger: { warn: vi.fn() } };
});

vi.mock('../../../src/utils/permission-utils.js', () => {
	return { PermissionUtils: { canReact: vi.fn(() => true) } };
});

vi.mock('../../../src/utils/message-utils.js', () => {
	return { MessageUtils: { react: vi.fn(async () => { return { emoji: {} }; }) } };
});

import { MarkovReactionService } from '../../../src/services/markov-reaction.service.js';
import { MessageUtils } from '../../../src/utils/message-utils.js';
import { PermissionUtils } from '../../../src/utils/permission-utils.js';

import type { Guild, GuildEmoji, Message } from 'discord.js';

const selectionInput = {
	content: 'look at this',
	author: 'Ada',
	imageUrl: 'https://example.com/image.png',
	recentMessages: [],
};

function createGuild(emojis: GuildEmoji[] = []): Guild {
	return {
		id: 'guild-1',
		emojis: {
			fetch: vi.fn(async () => new Collection(emojis.map(emoji => [emoji.id, emoji]))),
		},
		members: { me: { roles: { cache: new Collection() } } },
	} as unknown as Guild;
}

function createMessage(guild: Guild): Message {
	return {
		guild,
		channel: {},
		channelId: 'channel-1',
	} as unknown as Message;
}

describe('MarkovReactionService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(PermissionUtils.canReact).mockReturnValue(true);
		vi.mocked(MessageUtils.react).mockResolvedValue({ emoji: {} } as never);
	});

	it('offers Unicode and usable custom guild reactions to the picker', async () => {
		const customEmoji = {
			id: '123',
			name: 'party_blob',
			animated: true,
			available: true,
			roles: { cache: new Collection() },
		} as unknown as GuildEmoji;
		const picker = vi.fn(async (_input, candidates) => candidates.find(candidate => candidate.key === 'guild:123')?.key ?? null);
		const service = new MarkovReactionService(picker, { cooldownMs: 0 });
		const message = createMessage(createGuild([customEmoji]));

		await expect(service.react(message, selectionInput)).resolves.toBe(true);
		expect(picker).toHaveBeenCalledWith(
			selectionInput,
			expect.arrayContaining([
				expect.objectContaining({ key: 'unicode:0', label: '👍' }),
				expect.objectContaining({ key: 'guild:123', label: ':party_blob: (animated)' }),
			]),
			'channel-1',
		);
		expect(MessageUtils.react).toHaveBeenCalledWith(message, customEmoji);
	});

	it('falls back to Unicode when fetching guild emojis fails', async () => {
		const guild = createGuild();
		vi.mocked(guild.emojis.fetch).mockRejectedValueOnce(new Error('Discord unavailable'));
		const picker = vi.fn(async (_input, candidates) => candidates[0].key);
		const service = new MarkovReactionService(picker, { cooldownMs: 0 });

		await expect(service.react(createMessage(guild), selectionInput)).resolves.toBe(true);
		expect(MessageUtils.react).toHaveBeenCalledWith(expect.anything(), '👍');
	});

	it('filters unavailable and role-restricted custom emojis', async () => {
		const unavailable = {
			id: 'unavailable', available: false, roles: { cache: new Collection() },
		} as unknown as GuildEmoji;
		const restricted = {
			id: 'restricted', available: true, roles: { cache: new Collection([['role-1', { id: 'role-1' }]]) },
		} as unknown as GuildEmoji;
		const service = new MarkovReactionService(async () => null);

		const candidates = await service.buildCandidates(createGuild([unavailable, restricted]));
		expect(candidates.some(candidate => candidate.key === 'guild:unavailable')).toBe(false);
		expect(candidates.some(candidate => candidate.key === 'guild:restricted')).toBe(false);
	});

	it('rejects a picker key that is not in the candidate list', async () => {
		const service = new MarkovReactionService(async () => 'invented', { cooldownMs: 0 });

		await expect(service.react(createMessage(createGuild()), selectionInput)).resolves.toBe(false);
		expect(MessageUtils.react).not.toHaveBeenCalled();
	});

	it('enforces the cooldown only after a successful reaction', async () => {
		let now = 1000;
		const picker = vi.fn(async () => 'unicode:0');
		const service = new MarkovReactionService(picker, { cooldownMs: 30000, now: () => now });
		const message = createMessage(createGuild());

		await expect(service.react(message, selectionInput)).resolves.toBe(true);
		now += 10000;
		await expect(service.react(message, selectionInput)).resolves.toBe(false);
		expect(picker).toHaveBeenCalledOnce();
	});

	it('allows only one in-flight selection per channel', async () => {
		let finishSelection: (key: string) => void = () => {};
		const selected = new Promise<string>((resolve) => {
			finishSelection = resolve;
		});
		const picker = vi.fn(async () => selected);
		const service = new MarkovReactionService(picker, { cooldownMs: 0 });
		const message = createMessage(createGuild());

		const first = service.react(message, selectionInput);
		await vi.waitFor(() => expect(picker).toHaveBeenCalledOnce());
		await expect(service.react(message, selectionInput)).resolves.toBe(false);
		finishSelection('unicode:0');
		await expect(first).resolves.toBe(true);
	});

	it('skips selection without reaction permission', async () => {
		vi.mocked(PermissionUtils.canReact).mockReturnValue(false);
		const picker = vi.fn(async () => 'unicode:0');
		const service = new MarkovReactionService(picker);

		await expect(service.react(createMessage(createGuild()), selectionInput)).resolves.toBe(false);
		expect(picker).not.toHaveBeenCalled();
	});

	it('does not react in DMs or when the feature is disabled', async () => {
		const picker = vi.fn(async () => 'unicode:0');
		const service = new MarkovReactionService(picker);
		const disabledService = new MarkovReactionService(picker, { enabled: false });
		const dmMessage = { guild: null, channel: {}, channelId: 'dm-1' } as unknown as Message;

		await expect(service.react(dmMessage, selectionInput)).resolves.toBe(false);
		await expect(disabledService.react(createMessage(createGuild()), selectionInput)).resolves.toBe(false);
		expect(picker).not.toHaveBeenCalled();
	});

	it('does not start the cooldown when Discord rejects the reaction', async () => {
		const picker = vi.fn(async () => 'unicode:0');
		vi.mocked(MessageUtils.react)
			.mockRejectedValueOnce(new Error('missing emoji'))
			.mockResolvedValueOnce({ emoji: {} } as never);
		const service = new MarkovReactionService(picker, { cooldownMs: 30000, now: () => 1000 });
		const message = createMessage(createGuild());

		await expect(service.react(message, selectionInput)).resolves.toBe(false);
		await expect(service.react(message, selectionInput)).resolves.toBe(true);
		expect(picker).toHaveBeenCalledTimes(2);
	});
});
