import {
    ApplicationCommandType,
    PermissionFlagsBits,
    PermissionsBitField,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
    RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from 'discord.js';

import { Args } from './index.js';
import { Language } from '../models/enum-helpers/index.js';
import { Lang } from '../services/index.js';

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
