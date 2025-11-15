import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';

import { FishingOption } from '../../enums/fishing-option.js';
import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { FishingService, Rarity } from '../../services/fishing.service.js';
import { Lang, Logger } from '../../services/index.js';
import { UserService } from '../../services/user.service.js';
import { InteractionUtils } from '../../utils/interaction-utils.js';
import { Command, CommandDeferType } from '../index.js';

export class FishingCommand implements Command {
    public names = [Lang.getRef('chatCommands.fishing', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    private readonly userService = new UserService();
    private readonly fishingService = new FishingService();

    /**
     * Execute the fishing management command
     * Shows stats or leaderboard based on option
     */
    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        try {
            const option = intr.options.getString(Lang.getRef('arguments.fishing', Language.Default)) as FishingOption;

            let embed: EmbedBuilder;

            switch (option) {
                case FishingOption.STATS: {
                    embed = await this.getStatsEmbed(intr);
                    break;
                }
                case FishingOption.LEADERBOARD: {
                    embed = await this.getLeaderboardEmbed();
                    break;
                }
                default: {
                    embed = new EmbedBuilder()
                        .setTitle('Invalid Option')
                        .setDescription('Please select either Stats or Leaderboard.')
                        .setColor(0xff0000);
                }
            }

            await InteractionUtils.send(intr, embed);
        } catch (error) {
            Logger.error('[FishingCommand] Error executing fishing command:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while fetching fishing data. Please try again later.')
                .setColor(0xff0000);

            await InteractionUtils.send(intr, errorEmbed);
        }
    }

    /**
     * Build stats embed for the user
     */
    private async getStatsEmbed(intr: ChatInputCommandInteraction): Promise<EmbedBuilder> {
        // Ensure user exists
        const user = await this.userService.ensureUserExists(intr.user.id, intr.user.tag);

        if (!user) {
            return new EmbedBuilder()
                .setTitle('Error')
                .setDescription('Failed to retrieve your user data.')
                .setColor(0xff0000);
        }

        // Get user stats
        const stats = await this.userService.getUserStats(user.id);

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle(`🎣 Fishing Stats for ${intr.user.tag}`)
            .setColor(0x3498db)
            .addFields(
                { name: '💰 Current Balance', value: `${user.money} coins`, inline: true },
                { name: '🐟 Total Catches', value: `${stats.totalCatches}`, inline: true },
                { name: '⭐ First Catches', value: `${stats.firstCatches}`, inline: true },
                { name: '💎 Total Value Caught', value: `${stats.totalValue} coins`, inline: true }
            );

        // Add rarest catch if exists
        if (stats.rarestCatch) {
            const rarityName = this.fishingService.getRarityName(stats.rarestCatch.rarity as Rarity);
            embed.addFields({
                name: '🏆 Rarest Catch',
                value: `${stats.rarestCatch.name} (${rarityName})`,
                inline: true,
            });
        } else {
            embed.addFields({
                name: '🏆 Rarest Catch',
                value: 'None yet - start fishing!',
                inline: true,
            });
        }

        embed.setFooter({ text: `Auto Fishing: ${user.autoFishing ? 'Enabled' : 'Disabled'}` });

        return embed;
    }

    /**
     * Build leaderboard embed
     */
    private async getLeaderboardEmbed(): Promise<EmbedBuilder> {
        // Get top users by money
        const topByMoney = await this.userService.getTopUsersByMoney(10);

        // Get top users by catches
        const topByCatches = await this.userService.getTopUsersByCatches(10);

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle('🏆 Fishing Leaderboards')
            .setColor(0xf39c12);

        // Top by money
        if (topByMoney.length > 0) {
            const moneyLeaderboard = topByMoney
                .map((user, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                    return `${medal} **${user.discordTag || 'Unknown'}** - ${user.money} coins`;
                })
                .join('\n');

            embed.addFields({
                name: '💰 Top by Money',
                value: moneyLeaderboard,
                inline: false,
            });
        }

        // Top by catches
        if (topByCatches.length > 0) {
            const catchesLeaderboard = topByCatches
                .map((entry, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                    return `${medal} **${entry.user.discordTag || 'Unknown'}** - ${entry.catchCount} catches`;
                })
                .join('\n');

            embed.addFields({
                name: '🐟 Top by Catches',
                value: catchesLeaderboard,
                inline: false,
            });
        }

        if (topByMoney.length === 0 && topByCatches.length === 0) {
            embed.setDescription('No fishing data yet. Be the first to catch something!');
        }

        return embed;
    }
}
