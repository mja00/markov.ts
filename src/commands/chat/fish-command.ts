import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang, Logger } from '../../services/index.js';
import {
    addCatch,
    addWorthToUser,
    ensureUserExists,
    firstCatch,
    pickCatchableByRarity,
} from '../../utils/db-utils.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class FishCommand implements Command {
    public names = [Lang.getRef('chatCommands.fish', Language.Default)];
    public cooldown = new RateLimiter(4, 60000);
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = [];

    private weightedRandom(spec: { [key: number]: number }): number {
        let i,
            sum = 0,
            r = Math.random();
        for (i in spec) {
            sum += spec[i];
            if (r <= sum) return parseInt(i);
        }
    }

    private rarityToName(rarity: number): string {
        switch (rarity) {
            case 0:
                return 'Trash';
            case 1:
                return 'Common';
            case 2:
                return 'Uncommon';
            case 3:
                return 'Rare';
            case 4:
                return 'Legendary';
        }
    }

    private rarityToEmoji(rarity: number): string {
        switch (rarity) {
            case 0:
                return '🟧';
            case 1:
                return '🟦';
            case 2:
                return '🟩';
            case 3:
                return '🟪';
            case 4:
                return '🟨';
        }
    }

    private getWeightSpec(baitType: string): { [key: number]: number } {
        switch (baitType) {
            default:
                return {
                    0: 0.5,
                    1: 0.3,
                    2: 0.1,
                    3: 0.08,
                    4: 0.02,
                };
        }
    }

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        const user = await ensureUserExists(intr.user.id, intr.user.tag);
        if (!user) {
            Logger.error(`User not found: ${intr.user.id}`);
            await InteractionUtils.send(intr, Lang.getEmbed('displayEmbeds.fishError', data.lang));
            return;
        }
        // We need to pick a rarity, there's common, uncommon, rare, and legendary. Which equate to 1-4
        // We want common to be the most common, and legendary to be the least common
        // TODO: Bait system
        const spec = this.getWeightSpec('none');
        const rarity = this.weightedRandom(spec);
        Logger.info(`Picked rarity: ${rarity} for ${intr.user.tag}`);
        const caught = await pickCatchableByRarity(rarity);
        if (caught === null) {
            // This means there's no catchables for that given rarity, we should return an error
            await InteractionUtils.send(intr, Lang.getEmbed('displayEmbeds.fishError', data.lang));
            return;
        }
        // Check to see if this has been caught before
        let firstTimeCaught = false;
        if (!caught.firstCaughtBy) {
            // This is the first time this has been caught
            Logger.info(`First time caught: ${caught.name}`);
            await firstCatch(user, caught);
            firstTimeCaught = true;
        }
        await addWorthToUser(user, caught.worth);
        await addCatch(user, caught);
        const rarityEmoji = this.rarityToEmoji(caught.rarity);
        const rarityName = this.rarityToName(caught.rarity);
        await InteractionUtils.send(
            intr,
            `You caught a... ${rarityEmoji} ${rarityName} ${caught.name}!` +
                (firstTimeCaught ? ` (You're the first to catch this!)` : '') +
                `\nThis is worth ${caught.worth} coins! You now have ${
                    user.money + caught.worth // Their money isn't updated since we'd need to requery
                } coins.`
        );
    }
}
