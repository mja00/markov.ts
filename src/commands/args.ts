import { APIApplicationCommandBasicOption, ApplicationCommandOptionType } from 'discord.js';

import { DevCommandName, FishingOption, HelpOption, InfoOption } from '../enums/index.js';
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
}
