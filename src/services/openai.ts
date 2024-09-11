/* eslint-disable import/no-extraneous-dependencies */
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import { ImageURL } from 'openai/resources/beta/threads/messages.js';
import { Thread } from 'openai/resources/beta/threads/threads.js';

import { ImageUpload } from './image-upload.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');
const openai = new OpenAI({
    apiKey: Config.openai.apiKey,
});

export class OpenAIService {
    // We want to store some state in the service
    private static instance: OpenAIService;
    private constructor() {}
    private threads: Map<string, Thread> = new Map();
    private imageUploadInstance: ImageUpload = ImageUpload.getInstance();

    public static getInstance(): OpenAIService {
        if (!OpenAIService.instance) {
            OpenAIService.instance = new OpenAIService();
        }
        return OpenAIService.instance;
    }

    public async createThread(channelId: string): Promise<OpenAI.Beta.Threads.Thread> {
        // If a thread already exists for this channel ID, return it
        const existingThread = this.threads.get(channelId);
        if (existingThread) {
            return existingThread;
        }
        const thread = await openai.beta.threads.create();
        this.threads.set(channelId, thread);
        return thread;
    }

    public async addThreadMessage(
        thread: OpenAI.Beta.Threads.Thread,
        message: string,
        username: string
    ): Promise<OpenAI.Beta.Threads.Messages.Message> {
        return await openai.beta.threads.messages.create(thread.id, {
            role: 'user',
            content: `${username}: ${message}`,
        });
    }

    public async addThreadMessageWithImage(
        thread: OpenAI.Beta.Threads.Thread,
        message: string,
        imageUrl: string,
        username: string
    ): Promise<OpenAI.Beta.Threads.Messages.Message> {
        return await openai.beta.threads.messages.create(thread.id, {
            role: 'user',
            content: [
                {
                    text: `${username}: ${message}`,
                    type: 'text',
                },
                {
                    image_url: {
                        url: imageUrl,
                    } as ImageURL,
                    type: 'image_url',
                },
            ],
        });
    }

    public async getThreadMessages(
        thread: OpenAI.Beta.Threads.Thread
    ): Promise<OpenAI.Beta.Threads.Messages.MessagesPage> {
        return await openai.beta.threads.messages.list(thread.id);
    }

    public async createThreadRun(
        thread: OpenAI.Beta.Threads.Thread
    ): Promise<OpenAI.Beta.Threads.Runs.Run> {
        const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: 'asst_JIWy13MvoTpNw8SvqdhfKSAD',
        });
        return run;
    }

    public async waitOnRun(
        run: OpenAI.Beta.Threads.Runs.Run,
        thread: OpenAI.Beta.Threads.Thread
    ): Promise<OpenAI.Beta.Threads.Runs.Run> {
        while (run.status === 'queued' || run.status === 'in_progress') {
            run = await openai.beta.threads.runs.retrieve(thread.id, run.id);
            // Wait half a second
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return run;
    }

    public async deleteThread(thread: OpenAI.Beta.Threads.Thread): Promise<void> {
        await openai.beta.threads.del(thread.id);
        this.threads.delete(thread.id);
    }

    public async generateImage(prompt: string): Promise<string> {
        try {
            const response = await openai.images.generate({
                model: 'dall-e-3',
                prompt: `I NEED to test how the tool works with extremely simple prompts. DO NOT add any detail, just use it AS-IS: ${prompt}`,
                size: '1024x1024',
                quality: 'standard',
                n: 1,
            });
            const image_url = response.data[0].url;
            const uploadedUrl = await this.imageUploadInstance.uploadImage(image_url);
            return uploadedUrl;
        } catch (error) {
            console.error(error);
            throw new Error(error.error.message);
        }
    }
}
