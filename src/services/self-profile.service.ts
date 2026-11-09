import type { Client } from 'discord.js';

export type SelfProfileEdit = {
	nick?: string | null;
	bio?: string | null;
	avatar?: Buffer | null;
	banner?: Buffer | null;
};

export type SelfProfileEditor = (guildSnowflake: string, edit: SelfProfileEdit, reason: string) => Promise<void>;

// Only the per-server profile is editable: the global avatar and username would change Markov in every server.
export const createSelfProfileEditor = (client: Client): SelfProfileEditor => async (guildSnowflake, edit, reason) => {
	const guild = await client.guilds.fetch(guildSnowflake);
	await guild.members.editMe({ ...edit, reason });
};
