import { createRequire } from 'node:module';

import { ShardingManager } from 'discord.js';
import { Request, Response, Router } from 'express';

import { GetGuildsResponse } from '../models/cluster-api/index.js';

import { Controller } from './index.js';

const require = createRequire(import.meta.url);
const Config = require('../../config/config.json');

export class GuildsController implements Controller {
	public path = '/guilds';
	public router: Router = Router();
	public authToken: string = Config.api.secret;

	constructor(private shardManager: ShardingManager) {}

	public register(): void {
		this.router.get('/', (req, res) => this.getGuilds(req, res));
	}

	private async getGuilds(req: Request, res: Response): Promise<void> {
		const guildIdsPerShard = await this.shardManager.broadcastEval(client => [...client.guilds.cache.keys()]);
		const guilds: string[] = [...new Set(guildIdsPerShard.flat())];

		const resBody: GetGuildsResponse = {
			guilds,
		};
		res.status(200).json(resBody);
	}
}
