# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript-based Markov chain text generation system with OpenAI integration. The project generates text using Markov chains trained on input data and can optionally use OpenAI's API for enhanced text generation and conversation handling.

## Development Commands

### Build and Development
```bash
npm run build          # Compile TypeScript to JavaScript
npm run dev            # Run development server with hot reload
npm start              # Start the production server
```

### Code Quality
```bash
npm run lint           # Run ESLint for code linting
npm run lint:fix       # Fix auto-fixable linting issues
npm run typecheck      # Run TypeScript type checking
```

### Testing
```bash
npm test               # Run all tests
npm run test:watch     # Run tests in watch mode
```

## Architecture Overview

### Core Components

- **MarkovChain** (`src/MarkovChain.ts`): The main class implementing Markov chain text generation
  - Handles state transitions and probability calculations
  - Supports configurable order (n-gram size) for chain complexity
  - Provides text generation with customizable parameters

- **OpenAI Integration** (`src/openai.ts`): Handles OpenAI API interactions
  - Thread management for conversation context
  - Response generation and processing
  - Credit tracking and usage monitoring

- **Type Definitions** (`src/types.ts`): Core TypeScript interfaces and types
  - `MarkovState`: Represents chain states and transitions
  - `GenerationOptions`: Configuration for text generation
  - OpenAI-related types for API integration

- **Utilities** (`src/utils.ts`): Helper functions for data processing
  - Text preprocessing and tokenization
  - File I/O operations
  - Data validation and sanitization

### Data Flow

1. Input text is processed and tokenized in utilities
2. MarkovChain builds state transition tables from processed data  
3. Text generation uses probability-based state transitions
4. OpenAI integration can enhance or supplement generated content
5. Results are processed and returned to the caller

### Key Design Patterns

- **Probabilistic State Machine**: Markov chains use statistical transitions between states
- **Strategy Pattern**: Different generation strategies (pure Markov vs OpenAI-enhanced)
- **Builder Pattern**: Configurable generation options and chain parameters

## Configuration

- TypeScript configuration in `tsconfig.json` with strict type checking
- ESLint configuration for code quality enforcement
- Build output to `dist/` directory

## Environment Variables

The application expects OpenAI API configuration through environment variables or configuration files for AI-enhanced features.