import { createRequire } from 'node:module';

import OpenAI from 'openai';

import { Logger } from './logger.js';

const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');
const openai = new OpenAI({ apiKey: Config.openai.apiKey });

const EMBEDDING_DIMENSION = 1536;
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_MAX_CONTENT_LENGTH = 1000;

export class EmbeddingService {
	public async createEmbedding(text: string): Promise<number[] | null> {
		const trimmed = text.trim();
		if (!trimmed) {
			return null;
		}

		const maxLength: number = Config.memory?.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
		const model: string = Config.memory?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
		const input = trimmed.slice(0, maxLength);

		try {
			const response = await openai.embeddings.create({ model, input });
			const embedding = response.data[0]?.embedding;

			if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
				Logger.error(
					`[EmbeddingService] Unexpected embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${embedding?.length ?? 'undefined'}`,
				);
				return null;
			}

			return embedding;
		} catch (error) {
			Logger.error('[EmbeddingService] Failed to create embedding:', error);
			return null;
		}
	}
}
