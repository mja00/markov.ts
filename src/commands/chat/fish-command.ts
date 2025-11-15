import { ChatInputCommandInteraction, EmbedBuilder, PermissionsString } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { Rarity } from '../../enums/rarity.js';
import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { FishingService } from '../../services/fishing.service.js';
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

            // Auto-use best consumable for rarity boost
            const itemEffectsService = this.fishingService.itemEffectsService;
            const bestConsumable = await itemEffectsService.getBestConsumableRarityBoost(user.id);
            let consumableBoost = 0;
            let usedConsumable: { name: string; boost: number } | null = null;

            if (bestConsumable) {
                const boostValue = parseFloat(bestConsumable.item.effectValue || '0');
                if (!isNaN(boostValue) && boostValue > 0) {
                    // Use the consumable
                    const consumed = await itemEffectsService.useConsumable(user.id, bestConsumable.item.id);
                    if (consumed) {
                        consumableBoost = boostValue;
                        usedConsumable = {
                            name: consumed.name,
                            boost: boostValue,
                        };
                        Logger.info(`[FishCommand] Auto-used consumable ${consumed.name} (+${(boostValue * 100).toFixed(0)}% boost) for ${intr.user.tag}`);
                    }
                }
            }

            // Determine rarity based on weighted random (with item effects + consumable)
            const rarity = await this.fishingService.determineRarity(user.id, consumableBoost);
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

            // Calculate final worth with item effects applied
            const finalWorth = await this.fishingService.calculateFinalWorth(caught.worth, user.id);

            // Add worth to user's balance
            await this.userService.addMoney(user.id, finalWorth);

            // Record the catch
            await this.fishingService.addCatch(user.id, caught.id);

            // Build response embed
            const rarityName = this.fishingService.getRarityName(caught.rarity as Rarity);
            const rarityColor = this.fishingService.getRarityColor(caught.rarity as Rarity);
            const newBalance = user.money + finalWorth;

            // Show worth with multiplier indicator if different from base
            const worthDisplay = finalWorth !== caught.worth ? `${caught.worth} → ${finalWorth}` : `${finalWorth}`;

            let description = `You caught a **${rarityName}** ${caught.name}!`;
            if (firstTimeCaught) {
                description += '\n\n🌟 **You\'re the first to catch this!**';
            }
            if (usedConsumable) {
                description += `\n\n🎣 Used **${usedConsumable.name}** (+${(usedConsumable.boost * 100).toFixed(0)}% rarity boost)`;
            }

            const embed = new EmbedBuilder()
                .setTitle('🎣 Fishing Success!')
                .setDescription(description)
                .addFields(
                    { name: 'Worth', value: `${worthDisplay} coins`, inline: true },
                    { name: 'New Balance', value: `${newBalance} coins`, inline: true },
                    { name: 'Rarity', value: rarityName, inline: true }
                )
                .setColor(rarityColor);

            // Add image if available
            if (caught.image) {
                embed.setThumbnail(caught.image);
            }

            await InteractionUtils.send(intr, embed);

            Logger.info(`[FishCommand] ${intr.user.tag} caught ${caught.name} (${rarityName}) worth ${finalWorth} coins (base: ${caught.worth})`);
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
