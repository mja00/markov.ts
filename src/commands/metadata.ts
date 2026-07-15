import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	PermissionFlagsBits,
	PermissionsBitField,
	RESTPostAPIChatInputApplicationCommandsJSONBody,
	RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from 'discord.js';

import { Language } from '../models/enum-helpers/index.js';
import { Lang } from '../services/index.js';

import { Args } from './index.js';

export const ChatCommandMetadata: {
	[command: string]: RESTPostAPIChatInputApplicationCommandsJSONBody;
} = {
	DEV: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.dev', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.dev'),
		description: Lang.getRef('commandDescs.dev', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.dev'),
		dm_permission: true,
		default_member_permissions: PermissionsBitField.resolve([
			PermissionFlagsBits.Administrator,
		]).toString(),
		options: [
			{
				...Args.DEV_COMMAND,
				required: true,
			},
		],
	},
	HELP: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.help', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.help'),
		description: Lang.getRef('commandDescs.help', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.help'),
		dm_permission: true,
		default_member_permissions: undefined,
		options: [
			{
				...Args.HELP_OPTION,
				required: true,
			},
		],
	},
	INFO: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.info', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.info'),
		description: Lang.getRef('commandDescs.info', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.info'),
		dm_permission: true,
		default_member_permissions: undefined,
		options: [
			{
				...Args.INFO_OPTION,
				required: true,
			},
		],
	},
	TEST: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.test', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.test'),
		description: Lang.getRef('commandDescs.test', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.test'),
		dm_permission: true,
		default_member_permissions: undefined,
	},
	GENERATE_IMAGE: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.generateImage', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.generateImage'),
		description: Lang.getRef('commandDescs.generateImage', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.generateImage'),
		dm_permission: true,
		default_member_permissions: undefined,
		options: [
			{
				...Args.GENERATE_IMAGE,
				required: true,
			},
		],
	},
	FISH: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.fish', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.fish'),
		description: Lang.getRef('commandDescs.fish', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.fish'),
		dm_permission: true,
		default_member_permissions: undefined,
	},
	FISHING: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.fishing', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.fishing'),
		description: Lang.getRef('commandDescs.fishing', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.fishing'),
		dm_permission: true,
		default_member_permissions: undefined,
		options: [
			{
				...Args.FISHING,
				required: true,
			},
		],
	},
	SHOP: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.shop', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.shop'),
		description: Lang.getRef('commandDescs.shop', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.shop'),
		dm_permission: true,
		default_member_permissions: undefined,
	},
	BUY: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.buy', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.buy'),
		description: Lang.getRef('commandDescs.buy', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.buy'),
		dm_permission: true,
		default_member_permissions: undefined,
		options: [
			{
				...Args.BUY,
				required: true,
			},
			{
				...Args.BUY_QUANTITY,
				required: false,
			},
		],
	},
	INVENTORY: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.inventory', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.inventory'),
		description: Lang.getRef('commandDescs.inventory', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.inventory'),
		dm_permission: true,
		default_member_permissions: undefined,
	},
	MEMORIES: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.memories', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.memories'),
		description: Lang.getRef('commandDescs.memories', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.memories'),
		dm_permission: true,
		default_member_permissions: undefined,
		options: [
			{ ...Args.MEMORIES_ACTION, required: true },
			{ ...Args.MEMORIES_SCOPE, required: false },
			{ ...Args.MEMORIES_ID, required: false },
			{ ...Args.MEMORIES_CONTENT, required: false },
		],
	},
	PROMPT: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.prompt', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.prompt'),
		description: Lang.getRef('commandDescs.prompt', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.prompt'),
		dm_permission: true,
		default_member_permissions: PermissionsBitField.resolve([
			PermissionFlagsBits.Administrator,
		]).toString(),
		options: [
			{ ...Args.PROMPT_ACTION, required: true },
			{ ...Args.PROMPT_MODEL, required: false },
			{ ...Args.PROMPT_EFFORT, required: false },
			{ ...Args.PROMPT_VERBOSITY, required: false },
			{ ...Args.PROMPT_SUMMARY, required: false },
		],
	},
	RESET: {
		type: ApplicationCommandType.ChatInput,
		name: Lang.getRef('chatCommands.reset', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('chatCommands.reset'),
		description: Lang.getRef('commandDescs.reset', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('commandDescs.reset'),
		dm_permission: true,
		default_member_permissions: undefined,
	},
	AUTOMATIONS: {
		type: ApplicationCommandType.ChatInput,
		name: 'automations',
		description: 'Enable, disable, preview, or configure opt-in assistant automations.',
		dm_permission: true,
		default_member_permissions: undefined,
		options: [
			{ type: ApplicationCommandOptionType.String,
				name: 'action',
				description: 'What to do.',
				required: true,
				choices: [
					{ name: 'Enable', value: 'enable' },
					{ name: 'Disable', value: 'disable' },
					{ name: 'Configure', value: 'configure' },
					{ name: 'Preview', value: 'preview' },
				] },
			{ type: ApplicationCommandOptionType.String,
				name: 'feature',
				description: 'Opt-in feature.',
				required: false,
				choices: [
					{ name: 'Daily fishing quests', value: 'dailyFishingQuests' },
					{ name: 'Rare catch alerts', value: 'rareCatchAlerts' },
					{ name: 'Weekly fishing summaries', value: 'weeklyFishingSummaries' },
					{ name: 'Collection reminders', value: 'collectionReminders' },
				] },
			{ type: ApplicationCommandOptionType.String, name: 'timezone', description: 'IANA timezone, e.g. America/New_York.', required: false },
			{ type: ApplicationCommandOptionType.String, name: 'quiet_start', description: 'Quiet hours start (HH:mm).', required: false },
			{ type: ApplicationCommandOptionType.String, name: 'quiet_end', description: 'Quiet hours end (HH:mm).', required: false },
			{ type: ApplicationCommandOptionType.String,
				name: 'frequency',
				description: 'Delivery frequency.',
				required: false,
				choices: [
					{ name: 'Daily', value: 'daily' }, { name: 'Weekly', value: 'weekly' }, { name: 'Monthly', value: 'monthly' },
				] },
			{ type: ApplicationCommandOptionType.Channel, name: 'destination', description: 'Destination channel.', required: false },
		],
	},
};

export const MessageCommandMetadata: {
	[command: string]: RESTPostAPIContextMenuApplicationCommandsJSONBody;
} = {
	VIEW_DATE_SENT: {
		type: ApplicationCommandType.Message,
		name: Lang.getRef('messageCommands.viewDateSent', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('messageCommands.viewDateSent'),
		default_member_permissions: undefined,
		dm_permission: true,
	},
};

export const UserCommandMetadata: {
	[command: string]: RESTPostAPIContextMenuApplicationCommandsJSONBody;
} = {
	VIEW_DATE_JOINED: {
		type: ApplicationCommandType.User,
		name: Lang.getRef('userCommands.viewDateJoined', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('userCommands.viewDateJoined'),
		default_member_permissions: undefined,
		dm_permission: true,
	},
};
