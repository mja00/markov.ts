import { describe, expect, it } from 'vitest';

import { resolveAutomationsEnabled } from '../../../src/services/automation-settings.js';

describe('resolveAutomationsEnabled', () => {
	it('defaults to enabled for backwards compatibility', () => {
		expect(resolveAutomationsEnabled({})).toBe(true);
	});

	it('honors the global kill switch', () => {
		expect(resolveAutomationsEnabled({ automations: { enabled: false } })).toBe(false);
	});
});
