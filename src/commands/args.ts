import { APIApplicationCommandBasicOption, ApplicationCommandOptionType } from 'discord.js';

import {
	DevCommandName,
	FishingOption,
	HelpOption,
	InfoOption,
	MemoryOption,
	PromptOption,
} from '../enums/index.js';
import { Language } from '../models/enum-helpers/index.js';
import { Lang } from '../services/index.js';

export class Args {
	public static readonly DEV_COMMAND: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.command', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.command'),
		description: Lang.getRef('argDescs.devCommand', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.devCommand'),
		type: ApplicationCommandOptionType.String,
		choices: [
			{
				name: Lang.getRef('devCommandNames.info', Language.Default),
				name_localizations: Lang.getRefLocalizationMap('devCommandNames.info'),
				value: DevCommandName.INFO,
			},
		],
	};
	public static readonly HELP_OPTION: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.option', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.option'),
		description: Lang.getRef('argDescs.helpOption', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.helpOption'),
		type: ApplicationCommandOptionType.String,
		choices: [
			{
				name: Lang.getRef('helpOptionDescs.commands', Language.Default),
				name_localizations: Lang.getRefLocalizationMap('helpOptionDescs.commands'),
				value: HelpOption.COMMANDS,
			},
		],
	};
	public static readonly INFO_OPTION: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.option', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.option'),
		description: Lang.getRef('argDescs.helpOption', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.helpOption'),
		type: ApplicationCommandOptionType.String,
		choices: [
			{
				name: Lang.getRef('infoOptions.about', Language.Default),
				name_localizations: Lang.getRefLocalizationMap('infoOptions.about'),
				value: InfoOption.ABOUT,
			},
		],
	};
	public static readonly GENERATE_IMAGE: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.prompt', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.prompt'),
		description: Lang.getRef('argDescs.generateImagePrompt', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.generateImagePrompt'),
		type: ApplicationCommandOptionType.String,
		required: true,
	};
	public static readonly FISHING: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.fishing', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.fishing'),
		description: Lang.getRef('argDescs.fishing', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.fishing'),
		type: ApplicationCommandOptionType.String,
		choices: [
			{
				name: 'Stats',
				value: FishingOption.STATS,
			},
			{
				name: 'Leaderboard',
				value: FishingOption.LEADERBOARD,
			},
		],
	};
	public static readonly BUY: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.buy', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.buy'),
		description: Lang.getRef('argDescs.buy', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.buy'),
		type: ApplicationCommandOptionType.String,
		required: true,
	};
	public static readonly BUY_QUANTITY: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.buyQuantity', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.buyQuantity'),
		description: Lang.getRef('argDescs.buyQuantity', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.buyQuantity'),
		type: ApplicationCommandOptionType.Integer,
		required: false,
		min_value: 1,
	};
	public static readonly MEMORIES_ACTION: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.memoriesAction', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.memoriesAction'),
		description: Lang.getRef('argDescs.memoriesAction', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.memoriesAction'),
		type: ApplicationCommandOptionType.String,
		choices: [
			{ name: 'List', value: MemoryOption.LIST },
			{ name: 'Forget', value: MemoryOption.FORGET },
			{ name: 'Forget All', value: MemoryOption.FORGET_ALL },
			{ name: 'Edit', value: MemoryOption.EDIT },
			{ name: 'Correct', value: MemoryOption.CORRECT },
		],
	};
	public static readonly MEMORIES_SCOPE: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.memoriesScope', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.memoriesScope'),
		description: Lang.getRef('argDescs.memoriesScope', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.memoriesScope'),
		type: ApplicationCommandOptionType.String,
		required: false,
		choices: [
			{ name: 'Mine', value: 'mine' },
			{ name: 'Server', value: 'server' },
		],
	};
	public static readonly MEMORIES_ID: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.memoriesId', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.memoriesId'),
		description: Lang.getRef('argDescs.memoriesId', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.memoriesId'),
		type: ApplicationCommandOptionType.String,
		required: false,
	};
	public static readonly MEMORIES_CONTENT: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.memoriesContent', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.memoriesContent'),
		description: Lang.getRef('argDescs.memoriesContent', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.memoriesContent'),
		type: ApplicationCommandOptionType.String,
		required: false,
		max_length: 1000,
	};
	public static readonly PROMPT_ACTION: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.promptAction', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.promptAction'),
		description: Lang.getRef('argDescs.promptAction', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.promptAction'),
		type: ApplicationCommandOptionType.String,
		choices: [
			{ name: 'View', value: PromptOption.VIEW },
			{ name: 'Edit prompt', value: PromptOption.EDIT },
			{ name: 'Set', value: PromptOption.SET },
			{ name: 'Reset', value: PromptOption.RESET },
		],
	};
	public static readonly PROMPT_MODEL: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.promptModel', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.promptModel'),
		description: Lang.getRef('argDescs.promptModel', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.promptModel'),
		type: ApplicationCommandOptionType.String,
		required: false,
	};
	public static readonly PROMPT_EFFORT: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.promptEffort', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.promptEffort'),
		description: Lang.getRef('argDescs.promptEffort', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.promptEffort'),
		type: ApplicationCommandOptionType.String,
		required: false,
		choices: [
			{ name: 'Minimal', value: 'minimal' },
			{ name: 'Low', value: 'low' },
			{ name: 'Medium', value: 'medium' },
			{ name: 'High', value: 'high' },
			{ name: 'Off', value: 'off' },
		],
	};
	public static readonly PROMPT_VERBOSITY: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.promptVerbosity', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.promptVerbosity'),
		description: Lang.getRef('argDescs.promptVerbosity', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.promptVerbosity'),
		type: ApplicationCommandOptionType.String,
		required: false,
		choices: [
			{ name: 'Low', value: 'low' },
			{ name: 'Medium', value: 'medium' },
			{ name: 'High', value: 'high' },
			{ name: 'Off', value: 'off' },
		],
	};
	public static readonly PROMPT_SUMMARY: APIApplicationCommandBasicOption = {
		name: Lang.getRef('arguments.promptSummary', Language.Default),
		name_localizations: Lang.getRefLocalizationMap('arguments.promptSummary'),
		description: Lang.getRef('argDescs.promptSummary', Language.Default),
		description_localizations: Lang.getRefLocalizationMap('argDescs.promptSummary'),
		type: ApplicationCommandOptionType.String,
		required: false,
		choices: [
			{ name: 'Auto', value: 'auto' },
			{ name: 'Concise', value: 'concise' },
			{ name: 'Detailed', value: 'detailed' },
			{ name: 'Off', value: 'off' },
		],
	};
}
