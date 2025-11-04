/* eslint-disable import/no-extraneous-dependencies */
import * as fal from '@fal-ai/serverless-client';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
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

export type GeneratedImageInfo = {
    filePath: string;
    filename: string;
    dataUrl: string;
};

export class OpenAIService {
    // We want to store some state in the service
    private static instance: OpenAIService;
    private constructor() {}
    private conversations: Map<string, ConversationState> = new Map();
    private imageUploadInstance: ImageUpload = ImageUpload.getInstance();
    // Track generated image info by response ID for later extraction
    private imageDataByResponseId: Map<string, GeneratedImageInfo[]> = new Map();
    
    // Function implementations for tool calls
    private randomNumberGenerator(args: { min: number; max: number }): number {
        const { min, max } = args;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    private callFunction(name: string, args: any): string {
        switch (name) {
            case 'random_number_generator': {
                const result = this.randomNumberGenerator(args);
                return result.toString();
            }
            default:
                Logger.warn(`Unknown function called: ${name}`);
                return 'Function not found';
        }
    }
    
    // Helper method to process a response and handle any function calls
    private async processResponseWithFunctionCalls(
        initialResponse: OpenAI.Responses.Response,
        promptConfig: OpenAI.Responses.ResponseCreateParams,
        channelId: string
    ): Promise<OpenAI.Responses.Response> {
        const followUpResponse = await this.handleToolCalls(initialResponse, promptConfig, channelId);
        
        // If we got a follow-up response, use that; otherwise use the original
        return followUpResponse || initialResponse;
    }
    
    // Save base64 image data locally and prepare for Discord upload
    private async saveGeneratedImage(base64Data: string): Promise<GeneratedImageInfo> {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(os.tmpdir(), 'markov-images');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
            Logger.info(`Created temp directory: ${tempDir}`);
        }
        
        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const filename = `generated-image-${timestamp}.png`;
        const tempFilePath = path.join(tempDir, filename);
        
        try {
            // Convert base64 to buffer
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // Save image to temp directory
            fs.writeFileSync(tempFilePath, imageBuffer);
            Logger.info(`Image saved to disk: ${tempFilePath}`);
            Logger.info(`Image size: ${imageBuffer.length} bytes`);

            // Prepare data URL for OpenAI follow-up requests
            const dataUrl = `data:image/png;base64,${base64Data}`;

            return {
                filePath: tempFilePath,
                filename: filename,
                dataUrl,
            };
        } catch (error) {
            Logger.error('Failed to save generated image locally:', error);
            throw error;
        }
    }
    
    // Bot instructions - replaces the assistant (fallback if no prompt ID configured)
    private readonly botInstructions = `You are a friendly Discord bot assistant. You can:
- Have conversations with users in Discord channels
- Generate images when requested using the image generation tool
- View and analyze images that users share
- Help with various tasks and questions

Each Discord channel maintains its own conversation context. Always be helpful, friendly, and engaging.`;

    // Tool definitions - Using built-in function format for OpenAI Responses API
    private readonly tools: OpenAI.Responses.Tool[] = [
        {
            name: 'random_number_generator',
            type: 'function',
            strict: true,
            description: 'Generates a truly random number within a specified range. Use this whenever the user asks for a random number, dice roll, or any form of randomization.',
            parameters: {
                type: 'object',
                required: ['min', 'max'],
                properties: {
                    min: {
                        type: 'number',
                        description: 'The minimum value (inclusive) of the random number range'
                    },
                    max: {
                        type: 'number',
                        description: 'The maximum value (inclusive) of the random number range'
                    }
                },
                additionalProperties: false
            }
        },
        {
            type: 'image_generation',
            background: 'opaque',
            input_fidelity: 'low',
            quality: 'medium',
            size: '1024x1024',
        }
    ];

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

        const initialResponse = await openai.responses.create({
            input: userInput,
            tools: this.tools,
            ...promptConfig,
            previous_response_id: conversation.lastResponseId,
        }) as OpenAI.Responses.Response;
        
        // Process any function calls and get the final response
        const response = await this.processResponseWithFunctionCalls(initialResponse, promptConfig, channelId);
        
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

        const initialResponse = await openai.responses.create({
            input: userInput,
            tools: this.tools,
            ...promptConfig,
            previous_response_id: conversation.lastResponseId,
        }) as OpenAI.Responses.Response;

        // Logger.info('Initial OpenAI response from sendMessage:', JSON.stringify({
        //     id: initialResponse.id,
        //     output_text: initialResponse.output_text,
        //     output: initialResponse.output,
        // }, null, 2));

        // Process any function calls and get the final response
        const response = await this.processResponseWithFunctionCalls(initialResponse, promptConfig, channelId);

        // Logger.info('Final processed response from sendMessage:', JSON.stringify({
        //     id: response.id,
        //     output_text: response.output_text,
        //     output: response.output,
        // }, null, 2));

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

        const initialResponse = await openai.responses.create({
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
            tools: this.tools,
            ...promptConfig,
            previous_response_id: conversation.lastResponseId,
        }) as OpenAI.Responses.Response;

        // Process any function calls and get the final response
        const response = await this.processResponseWithFunctionCalls(initialResponse, promptConfig, channelId);
        
        // Update conversation state
        conversation.lastResponseId = response.id;
        conversation.messageCount++;
        this.conversations.set(channelId, conversation);
        
        return response;
    }

    // Get response content from Responses API, handling function calls and image generation
    public async getResponseContent(response: OpenAI.Responses.Response): Promise<string> {
        Logger.info('Processing OpenAI response...');
        Logger.info('Response has output_text:', !!response.output_text);
        Logger.info('Response output array length:', response.output?.length || 0);
        
        // Process the response output array to handle text content
        if (response.output && Array.isArray(response.output)) {
            let textContent = '';
            
            for (const outputItem of response.output) {
                const status = 'status' in outputItem ? outputItem.status : 'N/A';
                Logger.info(`Processing output item type: ${outputItem.type}, status: ${status}`);
                
                // Handle message content (text responses)
                if (outputItem.type === 'message' && outputItem.content) {
                    for (const contentPart of outputItem.content) {
                        if (contentPart.type === 'output_text') {
                            textContent += contentPart.text;
                        }
                    }
                }
                // Note: Image generation calls are now handled in handleToolCalls
                // This allows the AI to provide a proper response after seeing the uploaded URL
            }
            
            Logger.info(`Final text content length: ${textContent.length}`);
            return textContent;
        }
        
        // Fallback to output_text if no output array
        if (response.output_text) {
            Logger.info('Using fallback output_text');
            return response.output_text;
        }
        
        Logger.warn('No content found in OpenAI response');
        return '';
    }

    // Get response content with images extracted from response outputs
    public getResponseContentWithImages(response: OpenAI.Responses.Response): { text: string; images: GeneratedImageInfo[] } {
        Logger.info('Processing OpenAI response with images...');
        Logger.info('Response has output_text:', !!response.output_text);
        Logger.info('Response output array length:', response.output?.length || 0);
        
        let textContent = '';
        const images: GeneratedImageInfo[] = [];
        
        // Check if we have tracked image info for this response
        const trackedImages = this.imageDataByResponseId.get(response.id);
        if (trackedImages) {
            images.push(...trackedImages);
            this.imageDataByResponseId.delete(response.id);
            Logger.info(`Found ${trackedImages.length} generated image(s) for response ${response.id}`);
        }
        
        // Process the response output array to handle text content
        if (response.output && Array.isArray(response.output)) {
            for (const outputItem of response.output) {
                const status = 'status' in outputItem ? outputItem.status : 'N/A';
                Logger.info(`Processing output item type: ${outputItem.type}, status: ${status}`);
                
                // Handle message content (text responses)
                if (outputItem.type === 'message' && outputItem.content) {
                    for (const contentPart of outputItem.content) {
                        if (contentPart.type === 'output_text') {
                            textContent += contentPart.text;
                        }
                    }
                }
                
                // Extract image URLs from image_generation_call outputs if they exist
                if (outputItem.type === 'image_generation_call') {
                    if ('status' in outputItem && outputItem.status === 'completed' && 'result' in outputItem && outputItem.result) {
                        // This is a base64 image, but we've already uploaded it
                        // The URL should be in trackedUrls, but if not, we can try to extract from the response
                        Logger.info('Found image_generation_call in response output');
                    }
                }
            }
        }
        
        // Fallback to output_text if no output array
        if (!textContent && response.output_text) {
            Logger.info('Using fallback output_text');
            textContent = response.output_text;
        }
        
        Logger.info(`Final text content length: ${textContent.length}, generated images: ${images.length}`);
        return { text: textContent, images };
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

    // Handle function calls and image generation in the response and execute them
    public async handleToolCalls(response: OpenAI.Responses.Response, promptConfig: OpenAI.Responses.ResponseCreateParams, channelId: string): Promise<OpenAI.Responses.Response | null> {
        let hasToolCalls = false;
        const inputMessages: any[] = []; // Don't copy output items - only include function call outputs and new messages
        const generatedImages: GeneratedImageInfo[] = [];
        const conversation = await this.getOrCreateConversation(channelId);
        
        Logger.info('handleToolCalls - Processing response with output length:', response.output?.length || 0);
        
        // Check if there are any tool calls in the response output
        if (response.output && Array.isArray(response.output)) {
            for (const outputItem of response.output) {
                Logger.info(`handleToolCalls - Processing output item type: ${outputItem.type}`);
                // Handle function calls according to the OpenAI docs
                if (outputItem.type === 'function_call') {
                    hasToolCalls = true;
                    const name = outputItem.name;
                    const args = JSON.parse(outputItem.arguments);
                    const callId = outputItem.call_id;
                    
                    Logger.info(`Executing function call: ${name} with args:`, args);
                    
                    try {
                        const result = this.callFunction(name, args);
                        
                        // Append the function call result to input messages
                        inputMessages.push({
                            type: 'function_call_output',
                            call_id: callId,
                            output: result
                        });
                        
                        Logger.info(`Function ${name} executed successfully with result: ${result}`);
                    } catch (error) {
                        Logger.error(`Error executing function ${name}:`, error);
                        
                        // Append error result
                        inputMessages.push({
                            type: 'function_call_output',
                            call_id: callId,
                            output: `Error: ${error.message || 'Function execution failed'}`
                        });
                    }
                }
                // Handle image generation calls
                else if (outputItem.type === 'image_generation_call') {
                    Logger.info('handleToolCalls - Found image_generation_call');
                    if ('status' in outputItem && outputItem.status === 'completed' && 'result' in outputItem && outputItem.result) {
                        hasToolCalls = true;
                        Logger.info('handleToolCalls - Processing completed image generation call');
                        
                        try {
                            // Save the generated image locally and prepare metadata
                            const generatedImage = await this.saveGeneratedImage(outputItem.result);
                            generatedImages.push(generatedImage);
                            
                            // Include the generated image as an input_image using a data URL so the AI can see it
                            // Also include text to inform the AI about the successful generation
                            inputMessages.push({
                                type: 'message',
                                role: 'user',
                                content: [
                                    {
                                        type: 'input_text',
                                        text: `I've generated the image you requested and attached it for your review.`
                                    },
                                    {
                                        type: 'input_image',
                                        image_url: generatedImage.dataUrl,
                                        detail: 'auto'
                                    }
                                ]
                            });
                            
                            Logger.info(`Image generated and stored locally: ${generatedImage.filePath}`);
                        } catch (error) {
                            Logger.error('Error processing image generation:', error);
                            
                            // Add error result as a message
                            inputMessages.push({
                                type: 'message',
                                role: 'user', 
                                content: [
                                    {
                                        type: 'input_text',
                                        text: `Error: Image generation failed - ${error.message || 'Upload failed'}`
                                    }
                                ]
                            });
                        }
                    }
                }
            }
        }
        
        // Track generated images for the original response BEFORE making follow-up request
        // This ensures we have them even if the follow-up fails
        if (generatedImages.length > 0) {
            this.imageDataByResponseId.set(response.id, generatedImages);
        }
        
        // If we had tool calls (functions or images), make a second request to get the final response
        if (hasToolCalls) {
            try {
                Logger.info('Making second request with function call results');
                const followUpResponse = await openai.responses.create({
                    input: inputMessages,
                    tools: this.tools,
                    ...promptConfig,
                    previous_response_id: response.id, // Maintain conversation context
                }) as OpenAI.Responses.Response;
                
                // Track generated images for this follow-up response as well
                if (generatedImages.length > 0) {
                    this.imageDataByResponseId.set(followUpResponse.id, generatedImages);
                    this.imageDataByResponseId.delete(response.id);
                }
                
                // Update conversation state with the follow-up response ID
                conversation.lastResponseId = followUpResponse.id;
                this.conversations.set(channelId, conversation);
                
                return followUpResponse;
            } catch (error) {
                Logger.error('Error making follow-up request:', error);
                // Even if follow-up fails, we've already tracked the image URLs for the original response
                // Return null so the original response is used, which will have the tracked URLs
                return null;
            }
        }
        
        // No function calls, return null to indicate no follow-up needed
        return null;
    }

    public async backupAndCleanupImages(images: GeneratedImageInfo[]): Promise<void> {
        if (!images || images.length === 0) {
            return;
        }

        for (const image of images) {
            try {
                const imageBuffer = await fs.promises.readFile(image.filePath);
                const backupUrl = await this.imageUploadInstance.uploadImageBuffer(imageBuffer);
                Logger.info(`Backed up generated image to Zipline: ${backupUrl}`);

                await fs.promises.unlink(image.filePath);
                Logger.info(`Removed local generated image file: ${image.filePath}`);
            } catch (error) {
                Logger.error(`Failed to backup or cleanup generated image ${image.filePath}:`, error);
            }
        }
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
