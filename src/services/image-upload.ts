import fetch from 'node-fetch';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { Logger } from './logger.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');

interface OAuth {
    id: number;
    // Provider is an enum of DISCORD, GITHUB, or GOOGLE
    provider: string;
    userId: number;
    oauthId: string;
    username: string;
    token: string;
    refresh: string;
}

interface User {
    id: number;
    username: string;
    avatar: string;
    token: string;
    administrator: boolean;
    superAdmin: boolean;
    systemTheme: string;
    embedTitle: string;
    embedColor: string;
    embedSiteName: string;
    ratelimit: Date;
    totpSecret: string;
    domains: string[];
    oauth: OAuth[];
}

export class ImageUpload {
    private static instance: ImageUpload;
    private constructor() {}
    private ziplineCookie: string;
    private ziplineToken: string;

    public static getInstance(): ImageUpload {
        if (!ImageUpload.instance) {
            ImageUpload.instance = new ImageUpload();
        }
        return ImageUpload.instance;
    }

    public async getZiplineCookie(): Promise<string> {
        const body = {
            username: Config.imageUpload.username,
            password: Config.imageUpload.password,
        };
        // We need to post /auth/login with the body to get the cookie

        const response = await fetch(Config.imageUpload.baseUrl + '/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (response.status !== 200) {
            Logger.error('Failed to get zipline cookie', await response.text());
            throw new Error('Failed to get zipline cookie');
        }
        // We need to get the user cookie from the cookies
        const cookies = response.headers.get('set-cookie');
        // find the user cookie
        const userCookie = cookies?.split(';').find(cookie => cookie.startsWith('user'));
        if (!userCookie) {
            throw new Error('Failed to get zipline cookie');
        }
        // return the user cookie
        this.ziplineCookie = userCookie;
        return userCookie;
    }

    public async getZiplineToken(): Promise<string> {
        // Ensure we have a cookie
        if (!this.ziplineCookie) {
            Logger.warn('No zipline cookie, getting a new one');
            await this.getZiplineCookie();
        }
        // Token comes from /user in the token field
        const response = await fetch(Config.imageUpload.baseUrl + '/user', {
            headers: {
                cookie: this.ziplineCookie,
            },
        });
        // If the response is not 200, throw an error
        if (response.status !== 200) {
            Logger.error('Failed to get zipline token', await response.text());
            throw new Error('Failed to get zipline token');
        }
        const json = await response.json();
        // Cast it to the user interface
        const user = json as User;
        // return the token
        this.ziplineToken = user.token;
        return user.token;
    }

    public async uploadImage(imageUrl: string, attempt: number = 0): Promise<string> {
        // If we're at 5 attempts, throw an error
        if (attempt >= 5) {
            throw new Error('Failed to upload image');
        }
        // Ensure we have a token
        if (!this.ziplineToken) {
            Logger.warn('No zipline token, getting a new one');
            await this.getZiplineToken();
        }
        // Create a hash off the image url, we'll use this as the file name
        const hash = crypto.createHash('sha256').update(imageUrl).digest('hex');
        // First we need to download the image into a buffer, we'll use this to upload later
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        Logger.info('Image downloaded');
        // Now we need to upload the image
        // This is a multipart form request
        const formData = new FormData();
        // Add the image to the form
        formData.append('file', new Blob([Buffer.from(imageBuffer)]), `${hash}.png`);
        const headers = {
            Authorization: this.ziplineToken,
            'x-zipline-folder': '2',
        };
        // Upload the image
        const response = await fetch(Config.imageUpload.baseUrl + '/upload', {
            method: 'POST',
            headers: headers,
            body: formData,
        });
        if (response.status === 200) {
            Logger.info('Image uploaded');
            const json = await response.json();
            return json['files'][0];
        } else {
            // Something went wrong, log it and retry
            Logger.error(
                `Failed to upload image. Status: ${response.status}. Retrying...`,
                await response.text()
            );
            return await this.uploadImage(imageUrl, attempt + 1);
        }
    }
}
