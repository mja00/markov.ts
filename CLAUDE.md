# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Discord.js bot written in TypeScript, built on the Discord Bot TypeScript Template. The bot features a fishing game with an economy system, AI-powered image generation, and OpenAI integration for enhanced interactions.

## Development Commands

### Build and Development
```bash
npm run build          # Compile TypeScript to JavaScript
npm start              # Start the bot (single instance)
npm run start:manager  # Start with shard manager for multiple shards
npm run start:pm2      # Start with PM2 process manager
```

### Code Quality
```bash
npm run lint           # Run ESLint for code linting
npm run lint:fix       # Fix auto-fixable linting issues
npm run format         # Check code formatting with Prettier
npm run format:fix     # Fix code formatting issues
```

### Testing
```bash
npm test               # Run all tests
npm run test:unit      # Run unit tests only
npm run test:integration # Run integration tests only
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
```

### Database Management
```bash
npm run db:generate    # Generate database migrations
npm run db:push        # Push schema changes to database
npm run db:migrate     # Run database migrations
npm run db:seed        # Seed database with initial data
npm run db:setup       # Push schema and seed data
npm run db:studio      # Open Drizzle Studio for database management
```

### Command Management
```bash
npm run commands:view [GUILD_ID]      # View registered commands
npm run commands:register [GUILD_ID]  # Register commands (guild-specific if ID provided)
npm run commands:clear [GUILD_ID]     # Clear registered commands
npm run commands:rename                # Rename a command
npm run commands:delete                # Delete a specific command
```

## Architecture Overview

### Core Components

- **Bot Initialization** (`src/start-bot.ts`, `src/start-manager.ts`): Entry points for bot and shard manager
  - Bot setup and configuration
  - Command registration
  - Event handler initialization
  - Service initialization (OpenAI, Database)

- **Commands** (`src/commands/`): Discord slash commands
  - **Chat Commands**: `/fish`, `/fishing`, `/shop`, `/buy`, `/inventory`, `/generate-image`, `/help`, `/info`, `/test`, `/dev`
  - **Context Menu Commands**: View date sent (message), View date joined (user)
  - Command metadata and argument definitions in `metadata.ts` and `args.ts`

- **Services** (`src/services/`): Business logic layer
  - **FishingService**: Core fishing mechanics and catch logic
  - **UserService**: User data management
  - **GuildService**: Server settings and configuration
  - **DatabaseService**: Database connection and query management (Drizzle ORM)
  - **OpenAIService**: OpenAI API integration for AI features
  - **ImageUpload**: Image upload to fal.ai for AI-generated images
  - **ItemEffectsService**: Item effect calculations (rarity boosts, worth multipliers)
  - **FishingCooldownService**: Rate limiting for fishing commands
  - **ShopService**: Shop and purchase management

- **Database Schema** (`src/db/schema.ts`): PostgreSQL schema using Drizzle ORM
  - **users**: Discord user profiles with money and auto-fishing status
  - **catchables**: Fish and items that can be caught (rarity, worth, images)
  - **catches**: Record of user catches
  - **items**: Purchasable items with effects (consumable/passive)
  - **shop**: Items available for purchase
  - **purchases**: Purchase history
  - **inventory**: User item inventory
  - **guilds**: Server-specific settings (cooldown limits)

- **Events** (`src/events/`): Discord event handlers
  - **CommandHandler**: Slash command execution
  - **ButtonHandler**: Button interaction handling
  - **MessageHandler**: Message event processing
  - **ReactionHandler**: Reaction event processing
  - **TriggerHandler**: Custom trigger system
  - **GuildJoinHandler**: New server welcome messages
  - **GuildLeaveHandler**: Server leave cleanup

- **Utilities** (`src/utils/`): Helper functions
  - **ClientUtils**: Discord client helpers
  - **CommandUtils**: Command processing utilities
  - **MessageUtils**: Message formatting and sending
  - **PermissionUtils**: Permission checking
  - **DbUtils**: Database query helpers
  - **FormatUtils**: Data formatting
  - **StringUtils**: String manipulation
  - **MathUtils**: Mathematical calculations
  - **RandomUtils**: Random number generation

- **Models** (`src/models/`): Data models and type definitions
  - **ConfigModels**: Configuration types
  - **InternalModels**: Internal data structures
  - **API Models**: REST API request/response types for cluster API

### Key Features

1. **Fishing Game**
   - Catch various fish/items with different rarities
   - Economy system with money and purchasable items
   - Item effects (rarity boosts, worth multipliers)
   - Auto-fishing capability
   - Cooldown system to prevent spam

2. **AI Integration**
   - OpenAI API for enhanced interactions
   - Image generation via fal.ai
   - Thread management for conversation context

3. **Scalability**
   - Sharding support for large bot deployments (2500+ servers)
   - Clustering support for multi-machine deployment
   - PM2 process manager integration
   - Cluster API for cross-shard communication

4. **Developer Features**
   - TypeScript with strict type checking
   - ESM modules for modern JavaScript
   - Comprehensive testing with Vitest
   - Database migrations with Drizzle Kit
   - Localization support via `lang/` directory

### Data Flow

1. User invokes slash command in Discord
2. CommandHandler receives interaction and routes to appropriate Command
3. Command validates permissions and arguments
4. Command calls relevant Service(s) for business logic
5. Service queries/updates database via DatabaseService
6. Service applies game logic (e.g., fishing mechanics, item effects)
7. Results formatted and sent back to Discord user via MessageUtils

### Key Design Patterns

- **Handler Pattern**: Event handlers process Discord events and route to appropriate components
- **Service Layer**: Business logic separated from command/event handling
- **Repository Pattern**: DatabaseService abstracts database operations
- **Factory Pattern**: Command and event handler registration
- **Singleton Pattern**: Services like OpenAIService and DatabaseService

## Configuration

- **TypeScript**: `tsconfig.json` with strict type checking, ESM modules
- **ESLint**: `.eslintrc.json` for code quality
- **Prettier**: `.prettierrc.json` for code formatting
- **Vitest**: `vitest.config.ts` for testing configuration
- **Drizzle**: `src/drizzle.config.ts` for database configuration
- **Bot Config**: `config/config.json` (see `config/*.example.json` for templates)
- **Build Output**: `dist/` directory

## Environment Variables

Required environment variables (typically in `.env`):
- Discord bot token and client ID
- Database connection string (PostgreSQL)
- OpenAI API key (for AI features)
- fal.ai API key (for image generation)
- Bot developer Discord user ID(s)


## Reminders

- When wanting to create custom migration, use the following command to generate a migration file: `drizzle-kit generate --custom --name=<migration>`
- Always ensure you're running linting, type checks, builds, and tests after completing features