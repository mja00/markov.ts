# OpenAI Assistants API to Responses API Migration Plan

## Overview

This document outlines the migration from OpenAI's deprecated Assistants API to the new Responses API while maintaining all existing functionality including channel-based threading, image generation, and image analysis.

## Current Architecture (Assistants API)

### Key Components
- **Thread Management**: Each Discord channel maps to an OpenAI Assistant thread
- **Assistant Usage**: Hardcoded assistant ID (`asst_JIWy13MvoTpNw8SvqdhfKSAD`)
- **Message Flow**: `addThreadMessage()` → `createThreadRun()` → `waitOnRun()` → `handleRun()`
- **Tool Calling**: Custom `get_generated_image` function for Flux image generation
- **State Persistence**: Threads stored in `threads.json` file

### Current Methods
```typescript
- createThread(channelId)
- addThreadMessage(thread, message, username)  
- addThreadMessageWithImage(thread, message, imageUrl, username)
- addThreadReplyContext(thread, message, from)
- createThreadRun(thread)
- waitOnRun(run, thread)
- handleRequiresAction(run, thread)
- handleRun(run, thread)
- getThreadMessages(thread)
- deleteThread(thread)
```

## New Architecture (Responses API)

### Key Changes
- **Conversation State**: Replace threads with conversation state tracking via `previous_response_id`
- **Reusable Prompts**: Convert assistant instructions to `instructions` parameter
- **Single API Call**: Replace multi-step run process with single `responses.create()` call
- **Built-in Tools**: Use native `image_generation` tool instead of custom function
- **State Management**: Track conversations in memory + `conversations.json`

### New Methods
```typescript
- getOrCreateConversation(channelId): ConversationState
- sendMessage(channelId, message, username): OpenAI.Responses.Response
- sendMessageWithImage(channelId, message, imageUrl, username): OpenAI.Responses.Response
- sendMessageWithReplyContext(channelId, message, from, username): OpenAI.Responses.Response
- getResponseContent(response): string
- handleToolCalls(response): string[]
- deleteConversation(channelId): void
```

## Migration Steps

### Phase 1: Update Core Service (src/services/openai.ts)

#### 1.1 Replace Thread Tracking with Conversation State
```typescript
// OLD
private threads: Map<string, Thread> = new Map();

// NEW  
private conversations: Map<string, ConversationState> = new Map();

type ConversationState = {
    channelId: string;
    lastResponseId: string;
    messageCount: number;
    createdAt: number;
}
```

#### 1.2 Add Bot Instructions
```typescript
private readonly botInstructions = `You are a friendly Discord bot assistant. You can:
- Have conversations with users in Discord channels
- Generate images when requested using the image generation tool
- View and analyze images that users share
- Help with various tasks and questions

Each Discord channel maintains its own conversation context. Always be helpful, friendly, and engaging.`;
```

#### 1.3 Replace Thread Methods with Response Methods
- `createThread()` → `getOrCreateConversation()`
- `addThreadMessage()` → `sendMessage()`
- `addThreadMessageWithImage()` → `sendMessageWithImage()`
- `createThreadRun() + waitOnRun() + handleRun()` → Direct response from `responses.create()`

### Phase 2: Update Message Handlers

#### 2.1 Update Message Handler (src/events/message-handler.ts)
```typescript
// OLD Flow
const thread = await openaiService.createThread(channelId);
await openaiService.addThreadMessage(thread, message, username);
const run = await openaiService.createThreadRun(thread);
const finalRun = await openaiService.waitOnRun(run, thread);
const messages = await openaiService.handleRun(finalRun, thread);

// NEW Flow  
const response = await openaiService.sendMessage(channelId, message, username);
const content = openaiService.getResponseContent(response);
const imageUrls = await openaiService.handleToolCalls(response);
```

#### 2.2 Update Image Handling
```typescript
// OLD
await openaiService.addThreadMessageWithImage(thread, message, imageUrl, username);

// NEW
const response = await openaiService.sendMessageWithImage(channelId, message, imageUrl, username);
```

### Phase 3: Update State Persistence

#### 3.1 Change File Storage
- `threads.json` → `conversations.json`
- Store conversation state instead of thread objects
- Update `onShutdown()` and `getInstance()` methods

### Phase 4: Image Generation Updates

#### 4.1 Replace Custom Tool with Built-in Tool
```typescript
// OLD (Custom tool calling)
tools: [
  {
    type: "function",
    function: {
      name: "get_generated_image",
      description: "Generate an image",
      parameters: { /* ... */ }
    }
  }
]

// NEW (Built-in tool)
tools: [
  { type: 'image_generation' }
]
```

#### 4.2 Keep Flux Fallback
- Maintain `generateImageWithFlux()` method for alternative image generation
- Use as fallback if built-in tool doesn't meet needs

## Configuration Changes

### Remove Assistant ID
```json
// Remove from config.json
{
  "openai": {
    "apiKey": "...",
    // "assistantId": "asst_JIWy13MvoTpNw8SvqdhfKSAD" // <- Remove this
  }
}
```

## Testing Plan

### 1. Unit Tests
- Test conversation state management
- Test message sending with new API
- Test image handling (generation + analysis)
- Test state persistence

### 2. Integration Tests  
- Test Discord message flow end-to-end
- Test channel isolation (separate conversations)
- Test reply context functionality
- Test image generation workflow

### 3. Migration Tests
- Test existing conversations.json loading
- Test backwards compatibility during transition
- Test error handling and fallbacks

## Rollback Plan

### Option 1: Feature Flag
```typescript
const USE_RESPONSES_API = Config.openai.useResponsesAPI ?? false;

if (USE_RESPONSES_API) {
    // New Responses API code
} else {
    // Legacy Assistants API code  
}
```

### Option 2: Dual Implementation
- Keep both implementations side by side
- Gradually migrate channels one by one
- Monitor for issues and rollback if needed

## Risk Assessment

### High Risk
- **Breaking Changes**: API differences could break existing functionality
- **Token Usage**: Potential cost increase with full conversation history
- **Feature Gaps**: Some Assistants API features might not have direct equivalents

### Medium Risk  
- **Performance**: Single API call vs multi-step process performance differences
- **Error Handling**: New error patterns and failure modes
- **State Migration**: Converting existing thread data to conversation state

### Low Risk
- **Image Generation**: Built-in tools should provide similar functionality
- **Message Handling**: Core functionality remains the same

## Success Criteria

### Functional Requirements
- ✅ Channel-based conversations maintained
- ✅ Image generation working (DALL-E + Flux fallback)  
- ✅ Image analysis/vision capabilities preserved
- ✅ Reply context functionality maintained
- ✅ State persistence across bot restarts

### Performance Requirements
- Response times similar or better than current implementation
- Token usage within acceptable limits
- Memory usage optimized for conversation state tracking

### Quality Requirements
- No data loss during migration
- Error handling comprehensive
- Logging provides adequate debugging info
- Code maintainability improved over current implementation

## Timeline

1. **Week 1**: Core service migration (`openai.ts`)
2. **Week 2**: Message handler updates  
3. **Week 3**: Testing and integration
4. **Week 4**: Deployment and monitoring

## Dependencies

- OpenAI SDK supporting Responses API
- No breaking changes to Discord.js integration
- Configuration management for API keys
- Image upload service (`ImageUpload`) remains unchanged