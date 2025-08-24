/* eslint-disable import/no-extraneous-dependencies */
import * as fal from '@fal-ai/serverless-client';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import OpenAI from 'openai';

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

type ConversationState = {
    channelId: string;
    lastResponseId: string | null;
    messageCount: number;
    createdAt: number;
}

type DumpedConversations = ConversationState[]

export class OpenAIService {
    // We want to store some state in the service
    private static instance: OpenAIService;
    private constructor() {}
    private conversations: Map<string, ConversationState> = new Map();
    private imageUploadInstance: ImageUpload = ImageUpload.getInstance();
    
    // Bot instructions - replaces the assistant (fallback if no prompt ID configured)
    private readonly botInstructions = `You are a friendly Discord bot assistant. You can:
- Have conversations with users in Discord channels
- Generate images when requested using the image generation tool
- View and analyze images that users share
- Help with various tasks and questions

Each Discord channel maintains its own conversation context. Always be helpful, friendly, and engaging.`;

    // Reusable prompt configuration
    private getPromptConfig(channelId: string, username: string, additionalVariables: Record<string, any> = {}): OpenAI.Responses.ResponseCreateParams {
        const promptId = Config.openai?.promptId;
        const promptVersion = Config.openai?.promptVersion;

        if (promptId) {
            return {
                prompt: {
                    id: promptId,
                    ...(promptVersion && { version: promptVersion }),
                    variables: {
                        channel_id: channelId,
                        username: username,
                        timestamp: new Date().toISOString(),
                        ...additionalVariables
                    }
                }
            };
        }

        // Fallback to instructions if no prompt ID configured
        return {
            instructions: this.botInstructions
        };
    }

    public static async getInstance(): Promise<OpenAIService> {
        if (!OpenAIService.instance) {
            OpenAIService.instance = new OpenAIService();
            // Load conversation states from file 
            // If the file doesn't exist, we don't need to do anything
            if (!fs.existsSync('conversations.json')) {
                return OpenAIService.instance;
            }
            try {
                const conversations: DumpedConversations = JSON.parse(fs.readFileSync('conversations.json', 'utf8'));
                for (const conversation of conversations) {
                    Logger.info(`Loaded conversation for channel ${conversation.channelId}`);
                    OpenAIService.instance.conversations.set(conversation.channelId, conversation);
                }
            } catch (error) {
                Logger.error('Failed to load conversations:', error);
            }
        }
        return OpenAIService.instance;
    }

    // On shutdown, dump all conversations to file
    public async onShutdown(): Promise<void> {
        Logger.info('Dumping all conversations to file');
        const conversations = Array.from(this.conversations.values());
        if (conversations.length === 0) {
            Logger.info('No conversations to dump');
            return;
        }
        // Dump into a json file in the root of the project
        fs.writeFileSync('conversations.json', JSON.stringify(conversations, null, 2));
    }

    public async getOrCreateConversation(channelId: string): Promise<ConversationState> {
        // If a conversation already exists for this channel ID, return it
        const existingConversation = this.conversations.get(channelId);
        if (existingConversation) {
            return existingConversation;
        }
        
        // Create new conversation state
        const newConversation: ConversationState = {
            channelId,
            lastResponseId: null,
            messageCount: 0,
            createdAt: Date.now(),
        };
        
        this.conversations.set(channelId, newConversation);
        return newConversation;
    }

    // No longer needed with Responses API - conversations are stateless
    // Keeping for backwards compatibility during migration
    public async getThreadRuns(_threadId: string): Promise<any> {
        Logger.warn('getThreadRuns called - this method is deprecated with Responses API');
        return { data: [] };
    }

    public async sendMessageWithReplyContext(
        channelId: string,
        message: string,
        from: string,
        username: string
    ): Promise<OpenAI.Responses.Response> {
        const conversation = await this.getOrCreateConversation(channelId);
        const userInput = `${username} is replying to ${from}'s message: ${message}`;
        
        const promptConfig = this.getPromptConfig(channelId, username, {
            message: message,
            reply_context: `replying to ${from}`,
            original_message: message
        });

        const response = await openai.responses.create({
            model: 'gpt-5-nano',
            input: userInput,
            ...promptConfig,
            previous_response_id: conversation.lastResponseId,
        }) as OpenAI.Responses.Response;
        
        // Update conversation state
        conversation.lastResponseId = response.id;
        conversation.messageCount++;
        this.conversations.set(channelId, conversation);
        
        return response;
    }

    public async sendMessage(
        channelId: string,
        message: string,
        username: string
    ): Promise<OpenAI.Responses.Response> {
        const conversation = await this.getOrCreateConversation(channelId);
        const userInput = `${username}: ${message}`;
        
        const promptConfig = this.getPromptConfig(channelId, username, {
            message: message
        });
        
        const response = await openai.responses.create({
            model: 'gpt-5-nano',
            input: userInput,
            ...promptConfig,
            previous_response_id: conversation.lastResponseId,
        }) as OpenAI.Responses.Response;
        
        // Update conversation state
        conversation.lastResponseId = response.id;
        conversation.messageCount++;
        this.conversations.set(channelId, conversation);
        
        return response;
    }

    public async sendMessageWithImage(
        channelId: string,
        message: string,
        imageUrl: string,
        username: string
    ): Promise<OpenAI.Responses.Response> {
        const conversation = await this.getOrCreateConversation(channelId);
        
        const promptConfig = this.getPromptConfig(channelId, username, {
            message: message,
            has_image: 'true',
            image_url: imageUrl
        });
        
        const response = await openai.responses.create({
            model: 'gpt-5-nano',
            input: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: `${username}: ${message}`
                        },
                        {
                            type: 'input_image',
                            image_url: imageUrl,
                            detail: 'auto'
                        }
                    ]
                }
            ],
            ...promptConfig,
            previous_response_id: conversation.lastResponseId,
        }) as OpenAI.Responses.Response;
        
        // Update conversation state
        conversation.lastResponseId = response.id;
        conversation.messageCount++;
        this.conversations.set(channelId, conversation);
        
        return response;
    }

    // Get response content from Responses API
    public getResponseContent(response: OpenAI.Responses.Response): string {
        // Responses API uses output_text for the main text response
        if (response.output_text) {
            return response.output_text;
        }
        
        // Fallback: check if there are output items with message content
        if (response.output && Array.isArray(response.output)) {
            for (const outputItem of response.output) {
                if (outputItem.type === 'message' && outputItem.content) {
                    for (const contentPart of outputItem.content) {
                        if (contentPart.type === 'output_text') {
                            return contentPart.text;
                        }
                    }
                }
            }
        }
        
        return '';
    }

    // No longer needed - Responses API handles execution automatically
    // Keeping for backwards compatibility during migration
    public async createThreadRun(_thread: any): Promise<any> {
        Logger.warn('createThreadRun called - this method is deprecated with Responses API');
        return { status: 'completed' };
    }

    // No longer needed - Responses API is synchronous
    // Keeping for backwards compatibility during migration
    public async waitOnRun(run: any, _thread: any): Promise<any> {
        Logger.warn('waitOnRun called - this method is deprecated with Responses API');
        return run;
    }

    // Tool calling is now handled automatically by Responses API
    // Image generation will be handled by the built-in image_generation tool
    public async handleToolCalls(response: OpenAI.Responses.Response): Promise<string[]> {
        const imageUrls: string[] = [];
        
        // Check if there are any tool calls in the response output
        if (response.output && Array.isArray(response.output)) {
            for (const outputItem of response.output) {
                // Check for image generation tool calls or direct image outputs
                if (outputItem.type === 'message' && 'content' in outputItem && outputItem.content) {
                    for (const contentPart of outputItem.content) {
                        // Look for image outputs - this would depend on the actual response structure
                        if ('type' in contentPart && 'url' in contentPart) {
                            imageUrls.push(contentPart.url as string);
                            Logger.info('Found generated image URL');
                        }
                    }
                }
                // Handle tool call outputs that might contain images
                else if (outputItem.type === 'function_call' && 'output' in outputItem) {
                    // Tool call outputs might contain image URLs
                    const output = outputItem.output as any;
                    if (typeof output === 'string' && output.startsWith('http')) {
                        imageUrls.push(output);
                        Logger.info('Found tool-generated image URL');
                    }
                }
            }
        }
        
        return imageUrls;
    }

    // No longer needed - Responses API handles everything in one call
    // Keeping for backwards compatibility during migration
    public async handleRun(_run: any, _thread: any): Promise<any> {
        Logger.warn('handleRun called - this method is deprecated with Responses API');
        return { data: [] };
    }

    public async deleteConversation(channelId: string): Promise<void> {
        const conversation = this.conversations.get(channelId);
        if (conversation) {
            this.conversations.delete(channelId);
            Logger.info(`Deleted conversation for channel ${channelId}`);
        }
    }

    // Backwards compatibility methods for migration period
    public async createThread(channelId: string): Promise<{ id: string; object: string; created_at: number; metadata: null }> {
        Logger.warn('createThread called - using compatibility mode, consider updating to getOrCreateConversation');
        const conversation = await this.getOrCreateConversation(channelId);
        // Return a mock thread object for compatibility
        return {
            id: `conv_${conversation.channelId}`,
            object: 'conversation',
            created_at: conversation.createdAt,
            metadata: null,
        };
    }

    public async addThreadMessage(
        thread: { id: string },
        message: string,
        username: string
    ): Promise<{ id: string; object: string; created_at: number; role: string; content: Array<{ type: string; text: { value: string } }> }> {
        Logger.warn('addThreadMessage called - using compatibility mode, consider updating to sendMessage');
        const channelId = thread.id.replace('conv_', '');
        const _response = await this.sendMessage(channelId, message, username);
        // Return a mock message object for compatibility
        return {
            id: `msg_${Date.now()}`,
            object: 'thread.message',
            created_at: Date.now(),
            role: 'user',
            content: [{ type: 'text', text: { value: `${username}: ${message}` } }]
        };
    }

    public async addThreadMessageWithImage(
        thread: { id: string },
        message: string,
        imageUrl: string,
        username: string
    ): Promise<{ id: string; object: string; created_at: number; role: string; content: Array<{ type: string; text?: { value: string }; image_url?: { url: string } }> }> {
        Logger.warn('addThreadMessageWithImage called - using compatibility mode, consider updating to sendMessageWithImage');
        const channelId = thread.id.replace('conv_', '');
        const _response = await this.sendMessageWithImage(channelId, message, imageUrl, username);
        // Return a mock message object for compatibility
        return {
            id: `msg_${Date.now()}`,
            object: 'thread.message',
            created_at: Date.now(),
            role: 'user',
            content: [
                { type: 'text', text: { value: `${username}: ${message}` } },
                { type: 'image_url', image_url: { url: imageUrl } }
            ]
        };
    }

    public async addThreadReplyContext(
        thread: { id: string },
        message: string,
        from: string
    ): Promise<{ id: string; object: string; created_at: number; role: string; content: Array<{ type: string; text: { value: string } }> }> {
        Logger.warn('addThreadReplyContext called - this method is deprecated with Responses API');
        // Store reply context for next message - this is a simplified compatibility approach
        return {
            id: `msg_${Date.now()}`,
            object: 'thread.message',
            created_at: Date.now(),
            role: 'user',
            content: [{ type: 'text', text: { value: `Replying to ${from}: ${message}` } }]
        };
    }

    public async getThreadMessages(_thread: { id: string }): Promise<{ data: any[]; object: string; first_id: null; last_id: null; has_more: boolean }> {
        Logger.warn('getThreadMessages called - this method is deprecated with Responses API');
        return { 
            data: [],
            object: 'list',
            first_id: null,
            last_id: null,
            has_more: false
        };
    }

    public async deleteThread(thread: { id: string }): Promise<void> {
        Logger.warn('deleteThread called - using compatibility mode, consider updating to deleteConversation');
        const channelId = thread.id.replace('conv_', '');
        await this.deleteConversation(channelId);
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
