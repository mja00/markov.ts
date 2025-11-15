import { REST } from '@discordjs/rest';
import {
    APIApplicationCommand,
    RESTGetAPIApplicationCommandsResult,
    RESTPatchAPIApplicationCommandJSONBody,
    RESTPostAPIApplicationCommandsJSONBody,
    Routes,
} from 'discord.js';
import { createRequire } from 'node:module';

import { Logger } from './logger.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');
let Logs = require('../../lang/logs.json');

export class CommandRegistrationService {
    constructor(private rest: REST) {}

    public async process(
        localCmds: RESTPostAPIApplicationCommandsJSONBody[],
        args: string[]
    ): Promise<void> {
        // Check if a guild ID is provided for guild-specific registration
        const guildId = args[4];
        const isGuildSpecific = guildId && guildId.length > 0;

        // Use guild-specific or global routes
        const getCommandsRoute = isGuildSpecific
            ? Routes.applicationGuildCommands(Config.client.id, guildId)
            : Routes.applicationCommands(Config.client.id);

        let remoteCmds = (await this.rest.get(getCommandsRoute)) as RESTGetAPIApplicationCommandsResult;

        let localCmdsOnRemote = localCmds.filter(localCmd =>
            remoteCmds.some(remoteCmd => remoteCmd.name === localCmd.name)
        );
        let localCmdsOnly = localCmds.filter(
            localCmd => !remoteCmds.some(remoteCmd => remoteCmd.name === localCmd.name)
        );
        let remoteCmdsOnly = remoteCmds.filter(
            remoteCmd => !localCmds.some(localCmd => localCmd.name === remoteCmd.name)
        );

        switch (args[3]) {
            case 'view': {
                const scope = isGuildSpecific ? `guild ${guildId}` : 'global';
                Logger.info(
                    `Viewing ${scope} commands:\n` +
                        Logs.info.commandActionView
                            .replaceAll(
                                '{LOCAL_AND_REMOTE_LIST}',
                                this.formatCommandList(localCmdsOnRemote)
                            )
                            .replaceAll('{LOCAL_ONLY_LIST}', this.formatCommandList(localCmdsOnly))
                            .replaceAll('{REMOTE_ONLY_LIST}', this.formatCommandList(remoteCmdsOnly))
                );
                return;
            }
            case 'register': {
                const scope = isGuildSpecific ? `guild ${guildId}` : 'global';
                Logger.info(`Registering commands to ${scope}...`);

                // Use PUT for bulk registration/update (more efficient and correct)
                // This replaces all commands at once
                if (localCmds.length > 0) {
                    Logger.info(
                        `Syncing ${localCmds.length} command(s) to ${scope}...`
                    );
                    try {
                        const registeredCommands = (await this.rest.put(getCommandsRoute, {
                            body: localCmds,
                        })) as APIApplicationCommand[];
                        
                        Logger.info(
                            `✓ Successfully registered ${registeredCommands.length} command(s) to ${scope}`
                        );
                        Logger.info(
                            `  Commands: ${registeredCommands.map(cmd => `'${cmd.name}'`).join(', ')}`
                        );

                        if (!isGuildSpecific) {
                            Logger.warn(
                                '⚠ NOTE: Global commands can take up to 1 hour to appear in all servers.'
                            );
                            Logger.info(
                                '  Tip: Use guild-specific registration for instant updates during development.'
                            );
                            Logger.info(
                                '  Example: npm run commands:register <GUILD_ID>'
                            );
                        } else {
                            Logger.info(
                                '✓ Guild commands appear instantly! No waiting period required.'
                            );
                        }
                    } catch (error) {
                        Logger.error(`Failed to register commands to ${scope}:`, error);
                        throw error;
                    }
                } else {
                    Logger.info('No commands to register');
                }

                return;
            }
            case 'rename': {
                // For rename: args[4] could be guildId or oldName, args[5] could be oldName or newName
                // If args[4] looks like a Discord snowflake (18-19 digits), it's a guild ID
                let oldName: string;
                let newName: string;
                if (isGuildSpecific) {
                    oldName = args[5];
                    newName = args[6];
                } else {
                    oldName = args[4];
                    newName = args[5];
                }
                if (!(oldName && newName)) {
                    Logger.error(Logs.error.commandActionRenameMissingArg);
                    return;
                }

                let remoteCmd = remoteCmds.find(remoteCmd => remoteCmd.name == oldName);
                if (!remoteCmd) {
                    Logger.error(
                        Logs.error.commandActionNotFound.replaceAll('{COMMAND_NAME}', oldName)
                    );
                    return;
                }

                const commandRoute = isGuildSpecific
                    ? Routes.applicationGuildCommand(Config.client.id, guildId, remoteCmd.id)
                    : Routes.applicationCommand(Config.client.id, remoteCmd.id);

                Logger.info(
                    Logs.info.commandActionRenaming
                        .replaceAll('{OLD_COMMAND_NAME}', remoteCmd.name)
                        .replaceAll('{NEW_COMMAND_NAME}', newName)
                );
                let body: RESTPatchAPIApplicationCommandJSONBody = {
                    name: newName,
                };
                await this.rest.patch(commandRoute, {
                    body,
                });
                Logger.info(Logs.info.commandActionRenamed);
                return;
            }
            case 'delete': {
                // For delete: args[4] could be guildId or name
                let name: string;
                if (isGuildSpecific) {
                    name = args[5];
                } else {
                    name = args[4];
                }
                if (!name) {
                    Logger.error(Logs.error.commandActionDeleteMissingArg);
                    return;
                }

                let remoteCmd = remoteCmds.find(remoteCmd => remoteCmd.name == name);
                if (!remoteCmd) {
                    Logger.error(
                        Logs.error.commandActionNotFound.replaceAll('{COMMAND_NAME}', name)
                    );
                    return;
                }

                const commandRoute = isGuildSpecific
                    ? Routes.applicationGuildCommand(Config.client.id, guildId, remoteCmd.id)
                    : Routes.applicationCommand(Config.client.id, remoteCmd.id);

                Logger.info(
                    Logs.info.commandActionDeleting.replaceAll('{COMMAND_NAME}', remoteCmd.name)
                );
                await this.rest.delete(commandRoute);
                Logger.info(Logs.info.commandActionDeleted);
                return;
            }
            case 'clear': {
                const scope = isGuildSpecific ? `guild ${guildId}` : 'global';
                Logger.info(
                    `Clearing ${scope} commands: ` +
                        Logs.info.commandActionClearing.replaceAll(
                            '{COMMAND_LIST}',
                            this.formatCommandList(remoteCmds)
                        )
                );
                await this.rest.put(getCommandsRoute, { body: [] });
                Logger.info(Logs.info.commandActionCleared);
                return;
            }
        }
    }

    private formatCommandList(
        cmds: RESTPostAPIApplicationCommandsJSONBody[] | APIApplicationCommand[]
    ): string {
        return cmds.length > 0
            ? cmds.map((cmd: { name: string }) => `'${cmd.name}'`).join(', ')
            : 'N/A';
    }
}
