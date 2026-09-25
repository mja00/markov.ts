import { Locale } from 'discord.js';

// This class is used to store and pass data along in events
export class EventData {
	// TODO: Add any data you want to store
	constructor(
		// Event language
		public lang: Locale,
		// Guild language
		public langGuild: Locale,
	) {}
}

// A file produced during an AI response that is uploaded alongside the reply.
export type GeneratedAttachment = {
	filePath: string;
	filename: string;
	description: string;
	kind: 'image' | 'audio' | 'midi';
};
