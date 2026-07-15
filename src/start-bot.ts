import 'dotenv/config';

import { createRequire } from 'node:module';

import { REST } from '@discordjs/rest';
import { Options, Partials } from 'discord.js';

import { Button, MemoriesButton, ShopButton } from './buttons/index.js';
import {
	AutomationsCommand,
	BuyCommand,
	DevCommand,
	FishCommand,
	FishingCommand,
	GenerateImageCommand,
	HelpCommand,
	InfoCommand,
	InventoryCommand,
	MemoriesCommand,
	PromptCommand,
	ResetCommand,
	ShopCommand,
	TestCommand,
} from './commands/chat/index.js';
import {
	ChatCommandMetadata,
	Command,
	MessageCommandMetadata,
	UserCommandMetadata,
} from './commands/index.js';
import { ViewDateSent } from './commands/message/index.js';
import { ViewDateJoined } from './commands/user/index.js';
import {
	ButtonHandler,
	CommandHandler,
	GuildJoinHandler,
	GuildLeaveHandler,
	MessageHandler,
	ModalHandler,
	ReactionHandler,
	TriggerHandler,
} from './events/index.js';
import { CustomClient } from './extensions/index.js';
import { EnqueueProactiveMessagesJob, Job, ProcessScheduledMessagesJob } from './jobs/index.js';
import { Bot } from './models/bot.js';
import { Reaction } from './reactions/index.js';
import {
	CommandRegistrationService,
	DatabaseService,
	EventDataService,
	JobService,
	Logger,
	OpenAIService,
} from './services/index.js';
import { Trigger } from './triggers/index.js';

const require = createRequire(import.meta.url);
const Config = require('../config/config.json');
const Logs = require('../lang/logs.json');

async function start(): Promise<void> {
	// Services
	const eventDataService = new EventDataService();

	// Client
	const client = new CustomClient({
		intents: Config.client.intents,
		partials: (Config.client.partials as string[]).map(partial => Partials[partial]),
		makeCache: Options.cacheWithLimits({
			// Keep default caching behavior
			...Options.DefaultMakeCacheSettings,
			// Override specific options from config
			...Config.client.caches,
		}),
	});

	// Commands
	const commands: Command[] = [
		// Chat Commands
		new DevCommand(),
		new HelpCommand(),
		new InfoCommand(),
		new TestCommand(),
		new GenerateImageCommand(),
		new FishCommand(),
		new FishingCommand(),
		new ShopCommand(),
		new BuyCommand(),
		new InventoryCommand(),
		new MemoriesCommand(),
		new PromptCommand(),
		new ResetCommand(),
		new AutomationsCommand(),

		// Message Context Commands
		new ViewDateSent(),

		// User Context Commands
		new ViewDateJoined(),

		// TODO: Add new commands here
	];

	// Buttons
	const buttons: Button[] = [
		new ShopButton(),
		new MemoriesButton(),
		// TODO: Add new buttons here
	];

	// Reactions
	const reactions: Reaction[] = [
		// TODO: Add new reactions here
	];

	// Triggers
	const triggers: Trigger[] = [
		// TODO: Add new triggers here
	];

	// Event handlers
	const guildJoinHandler = new GuildJoinHandler(eventDataService);
	const guildLeaveHandler = new GuildLeaveHandler();
	const commandHandler = new CommandHandler(commands, eventDataService);
	const buttonHandler = new ButtonHandler(buttons, eventDataService);
	const modalHandler = new ModalHandler(eventDataService);
	const triggerHandler = new TriggerHandler(triggers, eventDataService);
	const messageHandler = new MessageHandler(triggerHandler);
	const reactionHandler = new ReactionHandler(reactions, eventDataService);

	// Jobs
	const jobs: Job[] = [
		// Runs per instance so it has a gateway client to send with; safe across
		// shards because each due message is claimed atomically, so it is never
		// posted twice (at-most-once delivery).
		new ProcessScheduledMessagesJob(client),
		new EnqueueProactiveMessagesJob(),
		// TODO: Add new jobs here
	];

	// Bot
	const bot = new Bot(
		Config.client.token,
		client,
		guildJoinHandler,
		guildLeaveHandler,
		messageHandler,
		commandHandler,
		buttonHandler,
		modalHandler,
		reactionHandler,
		new JobService(jobs),
	);

	// Register
	if (process.argv[2] === 'commands') {
		try {
			const rest = new REST({ version: '10' }).setToken(Config.client.token);
			const commandRegistrationService = new CommandRegistrationService(rest);
			const localCmds = [
				...Object.values(ChatCommandMetadata).sort((first, second) => (first.name > second.name ? 1 : -1)),
				...Object.values(MessageCommandMetadata).sort((first, second) => (first.name > second.name ? 1 : -1)),
				...Object.values(UserCommandMetadata).sort((first, second) => (first.name > second.name ? 1 : -1)),
			];
			await commandRegistrationService.process(localCmds, process.argv);
		} catch (error) {
			Logger.error(Logs.error.commandAction, error);
		}
		// Wait for any final logs to be written.
		await new Promise((resolve) => {
			setTimeout(resolve, 1000);
		});
		process.exit();
	}

	// Start an OpenAI service
	await OpenAIService.getInstance();

	// Connect to database
	try {
		await DatabaseService.getInstance().connect();
		Logger.info('Database connection established');
	} catch (error) {
		Logger.warn('Failed to connect to database - fishing features will be unavailable:', error);
	}

	await bot.start();
}

process.on('unhandledRejection', (reason, _promise) => {
	Logger.error(Logs.error.unhandledRejection, reason);
});

process.on('SIGINT', async () => {
	process.exit(0);
});

process.on('exit', async () => {
	Logger.info('Bot shutting down...');
	const openAI = await OpenAIService.getInstance();
	await openAI.onShutdown();

	// Disconnect from database
	await DatabaseService.getInstance().disconnect();
});

start().catch((error) => {
	Logger.error(Logs.error.unspecified, error);
});
