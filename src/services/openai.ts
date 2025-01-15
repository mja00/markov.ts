/* eslint-disable import/no-extraneous-dependencies */
import * as fal from '@fal-ai/serverless-client';
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import { ImageURL } from 'openai/resources/beta/threads/messages.js';
import { Thread } from 'openai/resources/beta/threads/threads.js';

import { ImageUpload } from './image-upload.js';
import { Logger } from './logger.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');
const openai = new OpenAI({
    apiKey: Config.openai.apiKey,
});

fal.config({
    credentials: Config.fal.apiKey,
});

type FalResponse = {
    images: Array<{
        url: string;
        width: number;
        height: number;
        content_type: string;
    }>;
    timings: {
        inference: number;
    };
    seed: number;
    has_nsfw_concepts: Array<boolean>;
    prompt: string;
};

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
        const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
            assistant_id: Config.openai.assistantId ?? 'asst_JIWy13MvoTpNw8SvqdhfKSAD',
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

    public async handleRequiresAction(
        run: OpenAI.Beta.Threads.Runs.Run,
        thread: OpenAI.Beta.Threads.Thread
    ): Promise<OpenAI.Beta.Threads.Messages.MessagesPage> {
        if (
            run.required_action &&
            run.required_action.submit_tool_outputs &&
            run.required_action.submit_tool_outputs.tool_calls
        ) {
            const toolOutputs = await Promise.all(
                run.required_action.submit_tool_outputs.tool_calls.map(async tool => {
                    console.log(tool.function.arguments);
                    if (tool.function.name === 'get_generated_image') {
                        const args = JSON.parse(tool.function.arguments);
                        const prompt = args['prompt'];
                        if (!prompt) {
                            Logger.error('prompt is empty');
                            return {
                                tool_call_id: tool.id,
                                output: 'failed do not retry',
                            };
                        }
                        const imageUrl = await this.generateImageWithFlux(prompt);
                        return {
                            tool_call_id: tool.id,
                            output: imageUrl,
                        };
                    }
                })
            );

            // Submit them
            if (toolOutputs.length > 0) {
                run = await openai.beta.threads.runs.submitToolOutputsAndPoll(thread.id, run.id, {
                    tool_outputs: toolOutputs,
                });
            }

            return await this.handleRun(run, thread);
        }
    }

    public async handleRun(
        run: OpenAI.Beta.Threads.Runs.Run,
        thread: OpenAI.Beta.Threads.Thread
    ): Promise<OpenAI.Beta.Threads.Messages.MessagesPage> {
        if (run.status === 'completed') {
            return await this.getThreadMessages(thread);
        } else if (run.status === 'requires_action') {
            return await this.handleRequiresAction(run, thread);
        } else if (run.status === 'failed') {
            const runFailedAt = run.failed_at ?? run.created_at;
            const errorCode = run.last_error?.code ?? 'unknown';
            const error = run.last_error?.message ?? 'unknown';
            Logger.error(`OpenAI run failed: ${errorCode} - ${error} (${new Date(runFailedAt).toLocaleString()})`);
            return;
        } else {
            console.error(`Unexpected run status: ${run.status}`);
            return;
        }
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

    async generateImageWithFlux(prompt: string): Promise<string> {
        if (!prompt) {
            return 'failed do not retry';
        }
        try {
            const results: FalResponse = await fal.subscribe('fal-ai/flux/schnell', {
                input: {
                    prompt: prompt,
                    image_size: 'landscape_4_3',
                    num_images: 1,
                    enable_safety_checker: false,
                },
                logs: true,
                onQueueUpdate: update => {
                    if (update.status === 'IN_PROGRESS') {
                        update.logs
                            .map(log => log.message)
                            .forEach(message => Logger.info(message));
                    } else {
                        Logger.info(update.status);
                    }
                },
            });

            // If any of them have nsfw concepts, we should NOT send the image
            if (results.has_nsfw_concepts.some(has_nsfw_concept => has_nsfw_concept)) {
                Logger.info(`NSFW image generated: ${results.images[0].url}`);
                console.log(`NSFW image generated: ${results.images[0].url}`);
                return;
            }

            const imageUrl = results.images[0].url;

            // Just reply to the interaction
            return imageUrl;
        } catch (error) {
            Logger.error(error);
            return 'failed do not retry';
        }
    }
}
