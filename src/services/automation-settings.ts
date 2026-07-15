import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type AutomationConfig = { automations?: { enabled?: boolean; }; };

let Config: AutomationConfig = {};
try {
	Config = require('../../config/config.json') as AutomationConfig;
} catch {
	// CI and unit tests may not have the gitignored runtime configuration.
}

export function resolveAutomationsEnabled(config: AutomationConfig): boolean {
	return config.automations?.enabled !== false;
}

export function areAutomationsEnabled(): boolean {
	return resolveAutomationsEnabled(Config);
}
