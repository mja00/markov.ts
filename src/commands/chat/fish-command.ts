import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { FishingService, Rarity } from '../../services/fishing.service.js';
import { Lang, Logger } from '../../services/index.js';
import { UserService } from '../../services/user.service.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class FishCommand implements Command {
    public names = [Lang.getRef('chatCommands.fish', Language.Default)];
    public cooldown = new RateLimiter(4, 60000);
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    private readonly userService = new UserService();
    private readonly fishingService = new FishingService();

    /**
     * Execute the fish command
     * Allows users to catch fish and earn coins
     */
    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        try {
            Logger.info(`[FishCommand] Fish command executed by ${intr.user.tag}`);

            // Ensure user exists in database
            const user = await this.userService.ensureUserExists(intr.user.id, intr.user.tag);

            if (!user) {
                Logger.error(`[FishCommand] Failed to create/get user: ${intr.user.id}`);
                await InteractionUtils.send(intr, Lang.getEmbed('displayEmbeds.fishError', data.lang));
                return;
            }

            // Determine rarity based on weighted random
            const rarity = this.fishingService.determineRarity();
            Logger.debug(`[FishCommand] Picked rarity: ${rarity} (${this.fishingService.getRarityName(rarity)}) for ${intr.user.tag}`);

            // Pick a random catchable of that rarity
            const caught = await this.fishingService.pickCatchableByRarity(rarity);

            if (!caught) {
                // No catchables for this rarity
                Logger.warn(`[FishCommand] No catchables found for rarity ${rarity}`);
                await InteractionUtils.send(intr, Lang.getEmbed('displayEmbeds.fishError', data.lang));
                return;
            }

            // Check if this is the first time this catchable has been caught
            const isFirstCatch = await this.fishingService.isFirstCatch(caught.id);
            let firstTimeCaught = false;

            if (isFirstCatch) {
                Logger.info(`[FishCommand] First time caught: ${caught.name} by ${intr.user.tag}`);
                await this.fishingService.markFirstCatch(caught.id, user.id);
                firstTimeCaught = true;
            }

            // Add worth to user's balance
            await this.userService.addMoney(user.id, caught.worth);

            // Record the catch
            await this.fishingService.addCatch(user.id, caught.id);

            // Build response embed
            const rarityName = this.fishingService.getRarityName(caught.rarity as Rarity);
            const rarityColor = this.fishingService.getRarityColor(caught.rarity as Rarity);
            const newBalance = user.money + caught.worth;

            const embed = new EmbedBuilder()
                .setTitle('🎣 Fishing Success!')
                .setDescription(
                    `You caught a **${rarityName}** ${caught.name}!` +
                        (firstTimeCaught ? '\n\n🌟 **You\'re the first to catch this!**' : '')
                )
                .addFields(
                    { name: 'Worth', value: `${caught.worth} coins`, inline: true },
                    { name: 'New Balance', value: `${newBalance} coins`, inline: true },
                    { name: 'Rarity', value: rarityName, inline: true }
                )
                .setColor(rarityColor);

            // Add image if available
            if (caught.image) {
                embed.setThumbnail(caught.image);
            }

            await InteractionUtils.send(intr, embed);

            Logger.info(`[FishCommand] ${intr.user.tag} caught ${caught.name} (${rarityName}) worth ${caught.worth} coins`);
        } catch (error) {
            Logger.error('[FishCommand] Error executing fish command:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while fishing. Please try again later.')
                .setColor(0xff0000);

            await InteractionUtils.send(intr, errorEmbed);
        }
    }
}
