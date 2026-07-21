import { createRequire } from 'node:module';

import {
	EmojiResolvable,
	Guild,
	GuildEmoji,
	Message,
} from 'discord.js';

import { Logger } from './logger.js';
import { MessageUtils } from '../utils/message-utils.js';
import { PermissionUtils } from '../utils/permission-utils.js';
import { RecentChannelMessage } from '../utils/recent-channel-context.js';


const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');

const UNICODE_REACTIONS = [
	'👍',
	'👎',
	'❤️',
	'😂',
	'😭',
	'😮',
	'😱',
	'🤔',
	'👀',
	'🔥',
	'🎉',
	'💯',
	'✅',
	'❌',
	'🙏',
	'👏',
	'🫡',
	'😅',
	'😬',
	'🤯',
	'😡',
	'🥳',
	'🫂',
] as const;

export type ReactionCandidate = {
	key: string;
	label: string;
	resolvable: EmojiResolvable;
};

export type MarkovReactionSelectionInput = {
	content: string;
	author: string;
	referencedMessage?: {
		author: string;
		content: string;
	};
	imageUrl?: string;
	recentMessages: RecentChannelMessage[];
};

export type MarkovReactionPicker = (
	input: MarkovReactionSelectionInput,
	candidates: ReactionCandidate[],
	routingKey: string,
) => Promise<string | null>;

type MarkovReactionServiceOptions = {
	enabled?: boolean;
	cooldownMs?: number;
	now?: () => number;
};

export class MarkovReactionService {
	private readonly enabled: boolean;
	private readonly cooldownMs: number;
	private readonly now: () => number;
	private readonly reactedAtByChannel = new Map<string, number>();
	private readonly inFlightChannels = new Set<string>();

	public constructor(
		private readonly pickReaction: MarkovReactionPicker,
		options: MarkovReactionServiceOptions = {},
	) {
		this.enabled = options.enabled ?? Config.messageReactions?.enabled ?? true;
		this.cooldownMs = options.cooldownMs
			?? Math.max(0, Config.messageReactions?.cooldownSeconds ?? 30) * 1000;
		this.now = options.now ?? Date.now;
	}

	public async react(
		msg: Message,
		input: MarkovReactionSelectionInput,
	): Promise<boolean> {
		if (!this.enabled || !msg.guild || !PermissionUtils.canReact(msg.channel)) {
			return false;
		}

		const channelId = msg.channelId;
		const lastReactedAt = this.reactedAtByChannel.get(channelId);
		if (lastReactedAt !== undefined && this.now() - lastReactedAt < this.cooldownMs) {
			return false;
		}
		if (this.inFlightChannels.has(channelId)) {
			return false;
		}

		this.inFlightChannels.add(channelId);
		try {
			const candidates = await this.buildCandidates(msg.guild);
			const selectedKey = await this.pickReaction(input, candidates, channelId);
			const selected = candidates.find(candidate => candidate.key === selectedKey);
			if (!selected) {
				return false;
			}

			const reaction = await MessageUtils.react(msg, selected.resolvable);
			if (!reaction) {
				return false;
			}

			this.reactedAtByChannel.set(channelId, this.now());
			return true;
		} catch (error) {
			Logger.warn('Failed to select or apply a Markov reaction:', error);
			return false;
		} finally {
			this.inFlightChannels.delete(channelId);
		}
	}

	public async buildCandidates(guild: Guild): Promise<ReactionCandidate[]> {
		const candidates: ReactionCandidate[] = UNICODE_REACTIONS.map((emoji, index) => {
			return {
				key: `unicode:${index}`,
				label: emoji,
				resolvable: emoji,
			};
		});

		try {
			const emojis = await guild.emojis.fetch();
			for (const emoji of emojis.values()) {
				if (!this.canUseGuildEmoji(emoji, guild)) {
					continue;
				}
				candidates.push({
					key: `guild:${emoji.id}`,
					label: `:${emoji.name ?? 'emoji'}:${emoji.animated ? ' (animated)' : ''}`,
					resolvable: emoji,
				});
			}
		} catch (error) {
			Logger.warn(`Failed to fetch custom reactions for guild ${guild.id}; using Unicode only:`, error);
		}

		return candidates;
	}

	private canUseGuildEmoji(emoji: GuildEmoji, guild: Guild): boolean {
		if (emoji.available === false) {
			return false;
		}
		if (emoji.roles.cache.size === 0) {
			return true;
		}

		const botMember = guild.members.me;
		return Boolean(botMember && emoji.roles.cache.some(role => botMember.roles.cache.has(role.id)));
	}
}
