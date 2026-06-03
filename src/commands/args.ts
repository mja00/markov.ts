import { APIApplicationCommandBasicOption, ApplicationCommandOptionType } from 'discord.js';

import {
	DevCommandName,
	FishingOption,
	HelpOption,
	InfoOption,
	MemoryOption,
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
}
