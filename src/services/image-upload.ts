import FormData from 'form-data';
import fetch from 'node-fetch';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as stream from 'node:stream';

import { Logger } from './logger.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');

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
        // v4 API uses /api/auth/login for authentication
        Logger.trace('Authenticating with Zipline v4 API...');

        const response = await fetch(Config.imageUpload.baseUrl + '/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const responseText = await response.text();
        Logger.trace(`Zipline auth response - Status: ${response.status}`);
        Logger.trace(`Zipline auth response - Body: ${responseText}`);

        if (response.status !== 200) {
            Logger.error('Failed to authenticate with Zipline v4:', responseText);
            throw new Error('Failed to get zipline cookie');
        }

        // v4 uses 'zipline_session' cookie instead of 'user'
        const cookies = response.headers.get('set-cookie');
        Logger.trace('Set-Cookie header:', cookies);
        
        if (!cookies) {
            throw new Error('No cookies returned from Zipline login');
        }

        // Find the zipline_session cookie
        const sessionCookie = cookies.split(';').find(cookie => 
            cookie.trim().startsWith('zipline_session=')
        );
        
        if (!sessionCookie) {
            Logger.error('zipline_session cookie not found in:', cookies);
            throw new Error('Failed to get zipline session cookie');
        }
        
        Logger.trace('Successfully obtained Zipline session cookie');
        this.ziplineCookie = sessionCookie.trim();
        return this.ziplineCookie;
    }

    public async getZiplineToken(): Promise<string> {
        // Ensure we have a cookie
        if (!this.ziplineCookie) {
            Logger.warn('No zipline cookie, getting a new one');
            await this.getZiplineCookie();
        }
        // v4 API: Token comes from /user/token endpoint
        Logger.trace('Getting token from Zipline v4 API...');
        
        const response = await fetch(Config.imageUpload.baseUrl + '/user/token', {
            headers: {
                'Cookie': this.ziplineCookie,
            },
        });
        
        const responseText = await response.text();
        Logger.trace(`Token response - Status: ${response.status}`);
        Logger.trace(`Token response - Body: ${responseText}`);
        
        if (response.status !== 200) {
            Logger.error('Failed to get zipline token:', responseText);
            throw new Error('Failed to get zipline token');
        }
        
        try {
            const json = JSON.parse(responseText);
            if (json.token) {
                this.ziplineToken = json.token;
                Logger.trace('Successfully obtained Zipline API token');
                return json.token;
            } else {
                Logger.error('No token in response:', json);
                throw new Error('No token returned from Zipline');
            }
        } catch (parseError) {
            Logger.error('Failed to parse token response:', parseError);
            throw new Error('Failed to parse token response');
        }
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
        Logger.trace('Image downloaded');
        // Now we need to upload the image
        // This is a multipart form request
        const formData = new FormData();
        // Add the image to the form
        formData.append('file', new Blob([Buffer.from(imageBuffer)]), `${hash}.png`);
        const headers = {
            Authorization: this.ziplineToken,
            'x-zipline-folder': 'cm793lcei0gtjo201lxjmy9zz',
        };
        // Upload the image
        const response = await fetch(Config.imageUpload.baseUrl + '/upload', {
            method: 'POST',
            headers: headers,
            body: formData,
        });
        if (response.status === 200) {
            Logger.trace('Image uploaded');
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

    public async uploadImageBuffer(imageBuffer: Buffer): Promise<string> {
        // Ensure we have a token
        if (!this.ziplineToken) {
            Logger.warn('No zipline token, getting a new one');
            await this.getZiplineToken();
        }
         // Create a hash off the image buffer for the filename
         const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
        
         const formData = new FormData();
         
         // Create a readable stream from the buffer
         const bufferStream = new stream.PassThrough();
         bufferStream.end(imageBuffer);
         
         formData.append('file', bufferStream, {
             filename: `${hash}.png`,
             contentType: 'image/png'
         });
         
         const headers = {
             ...formData.getHeaders(),
             'Authorization': this.ziplineToken,
             'x-zipline-folder': 'cm793lcei0gtjo201lxjmy9zz',
         };
         
         Logger.trace('Uploading generated image to Zipline v4...');
         
         // Upload the image using v4 API endpoint
         const response = await fetch(Config.imageUpload.baseUrl + '/upload', {
             method: 'POST',
             headers: headers,
             body: formData,
         });
         
         const responseText = await response.text();
         Logger.trace(`Zipline upload response - Status: ${response.status}`);
         Logger.trace(`Zipline upload response - Headers:`, Object.fromEntries(response.headers.entries()));
         Logger.trace(`Zipline upload response - Body: ${responseText}`);
         
         if (response.status === 200) {
             try {
                 const json = JSON.parse(responseText);
                 Logger.trace('Parsed JSON response:', json);
                 
                 // v4 response structure: { "files": [{ "id": "...", "type": "...", "url": "..." }] }
                 if (json.files && json.files.length > 0) {
                     const fileUrl = json.files[0].url;
                     Logger.trace(`Image uploaded successfully: ${fileUrl}`);
                     return fileUrl;
                 } else {
                     Logger.trace('No files in response - Full JSON:', json);
                     throw new Error('No files returned in upload response');
                 }
             } catch (parseError) {
                 Logger.trace('Failed to parse upload response as JSON:', parseError);
                 Logger.error('Raw response text:', responseText);
                 throw new Error('Failed to parse upload response');
             }
         } else {
             Logger.error(`Upload failed with status ${response.status}`);
             Logger.trace('Response headers:', Object.fromEntries(response.headers.entries()));
             Logger.trace('Response body:', responseText);
             throw new Error(`Failed to upload image. Status: ${response.status} - ${responseText}`);
         }
    }
}
