import { readFile } from 'node:fs/promises';

import { AttachmentBuilder } from 'discord.js';

import { assembleReply } from './web-source-utils.js';
import { Logger } from '../services/logger.js';

import type { GeneratedAttachment } from '../models/internal-models.js';
import type { ModerationService } from '../services/moderation.service.js';
import type { OpenAIService } from '../services/openai.js';
import type OpenAI from 'openai';

const SAFE_WEB_NOTICE = 'I couldn\'t safely deliver that web-assisted response. Please try again later.';
const DISCORD_MESSAGE_LIMIT = 2000;

export type MarkovReply = {
	content: string;
	files: AttachmentBuilder[];
	generated: GeneratedAttachment[];
	// False when moderation withheld the reply, so generated files are discarded instead of backed up.
	keepGenerated: boolean;
};

export type MarkovReplyOptions = {
	computationMs: number;
	moderationService?: ModerationService;
	signal?: AbortSignal;
	// Prepended above the model text; counted against Discord's message limit.
	header?: string;
};

function prettyMs(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

/**
 * Turns a finished model response into Discord-ready content and files, moderating web-assisted text.
 * Returns null when the model produced nothing deliverable.
 */
export async function prepareMarkovReply(
	openAI: OpenAIService,
	response: OpenAI.Responses.Response,
	options: MarkovReplyOptions,
): Promise<MarkovReply | null> {
	const responseData = openAI.getResponseContentWithAttachments(response);
	let modelText = responseData.text;
	if (!modelText && responseData.attachments.length === 0) {
		if (!responseData.web?.fallback) {
			return null;
		}
		modelText = 'I couldn\'t complete the web research right now. Please try again later.';
	}

	try {
		Logger.debug(`[OpenAI Response]: ${modelText.length} characters`);
		Logger.debug(`[OpenAI Attachments]: ${responseData.attachments.length} file(s) to send`);

		const header = options.header ?? '';
		const body = assembleReply({
			modelText,
			sources: responseData.web?.used ? responseData.web.sources : [],
			footer: `-# This is an AI response. The computation took ${prettyMs(options.computationMs)}.`,
			maxLength: DISCORD_MESSAGE_LIMIT - (header ? header.length + 1 : 0),
		});
		const content = header ? `${header}\n${body}` : body;

		if (responseData.web?.used) {
			const moderation = options.moderationService
				? await options.moderationService.moderate(content, options.signal)
				: { status: 'unavailable' as const };
			if (moderation.status !== 'allowed') {
				return { content: SAFE_WEB_NOTICE, files: [], generated: responseData.attachments, keepGenerated: false };
			}
		}

		const files: AttachmentBuilder[] = [];
		for (const file of responseData.attachments) {
			try {
				files.push(new AttachmentBuilder(await readFile(file.filePath), {
					name: file.filename,
					description: file.description,
				}));
			} catch (error) {
				Logger.error(`Failed to prepare ${file.filePath} for Discord`, error);
			}
		}

		return { content, files, generated: responseData.attachments, keepGenerated: true };
	} catch (error) {
		// Rendered files never reach finalization on failure, so drop them instead of leaking them in tmp.
		await openAI.cleanupGeneratedAttachments(responseData.attachments);
		throw error;
	}
}

/** Backs up or discards generated files once the reply has been sent. */
export async function settleGeneratedAttachments(openAI: OpenAIService, reply: MarkovReply): Promise<void> {
	if (reply.generated.length === 0) {
		return;
	}
	Logger.info('Finalizing generated attachments');
	try {
		if (reply.keepGenerated) {
			await openAI.finalizeAttachments(reply.generated);
		} else {
			// Moderation failures should not upload an image that will never be delivered.
			await openAI.cleanupGeneratedAttachments(reply.generated);
		}
	} catch (error) {
		Logger.error('Failed to finalize generated attachments:', error);
	}
}
