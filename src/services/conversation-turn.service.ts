export type ConversationTurnServiceOptions = {
	enabled?: boolean;
	windowMs?: number;
	now?: () => number;
};

type OpenTurn = {
	userSnowflake: string;
	expiresAt: number;
};

export class ConversationTurnService {
	private readonly enabled: boolean;
	private readonly windowMs: number;
	private readonly now: () => number;
	private readonly openTurns = new Map<string, OpenTurn>();

	public constructor(options: ConversationTurnServiceOptions = {}) {
		this.enabled = options.enabled ?? true;
		this.windowMs = Math.max(0, options.windowMs ?? 2 * 60 * 1000);
		this.now = options.now ?? Date.now;
	}

	public open(channelSnowflake: string, userSnowflake: string): void {
		if (!this.enabled || this.windowMs === 0) {
			return;
		}
		this.deleteExpiredTurns();

		this.openTurns.set(channelSnowflake, {
			userSnowflake,
			expiresAt: this.now() + this.windowMs,
		});
	}

	public consume(channelSnowflake: string, userSnowflake: string): boolean {
		const turn = this.openTurns.get(channelSnowflake);
		this.openTurns.delete(channelSnowflake);

		return this.enabled
			&& turn?.userSnowflake === userSnowflake
			&& turn.expiresAt > this.now();
	}

	private deleteExpiredTurns(): void {
		const now = this.now();
		for (const [channelSnowflake, turn] of this.openTurns) {
			if (turn.expiresAt <= now) {
				this.openTurns.delete(channelSnowflake);
			}
		}
	}
}
