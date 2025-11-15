import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { Logger } from './logger.js';
import * as schema from '../db/schema.js';

/**
 * Database service for managing PostgreSQL connections with Drizzle ORM
 * Implements singleton pattern with connection pooling
 */
export class DatabaseService {
    private static instance: DatabaseService | null = null;
    private db: PostgresJsDatabase<typeof schema> | null = null;
    private client: postgres.Sql | null = null;

    /**
     * Private constructor to enforce singleton pattern
     */
    private constructor() {}

    /**
     * Get the singleton instance of DatabaseService
     */
    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    /**
     * Initialize database connection
     * @param connectionString - PostgreSQL connection string
     * @throws Error if connection fails
     */
    public async connect(connectionString?: string): Promise<void> {
        if (this.db) {
            Logger.info('[DatabaseService] Database already connected');
            return;
        }

        const url = connectionString || process.env.DATABASE_URL;

        if (!url) {
            throw new Error('DATABASE_URL is not defined in environment variables');
        }

        try {
            Logger.info('[DatabaseService] Connecting to database...');

            // Create postgres client with connection pooling
            this.client = postgres(url, {
                max: 10, // Maximum number of connections in the pool
                idle_timeout: 20, // Close idle connections after 20 seconds
                connect_timeout: 10, // Connection timeout in seconds
            });

            // Initialize Drizzle ORM
            this.db = drizzle(this.client, { schema });

            // Test the connection
            await this.client`SELECT 1`;

            Logger.info('[DatabaseService] Database connected successfully');
        } catch (error) {
            Logger.error('[DatabaseService] Failed to connect to database:', error);
            throw new Error(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get the Drizzle database instance
     * @throws Error if database is not connected
     */
    public getDb(): PostgresJsDatabase<typeof schema> {
        if (!this.db) {
            throw new Error('Database not connected. Call connect() first.');
        }
        return this.db;
    }

    /**
     * Close database connection and cleanup resources
     */
    public async disconnect(): Promise<void> {
        if (this.client) {
            Logger.info('[DatabaseService] Closing database connection...');
            await this.client.end();
            this.client = null;
            this.db = null;
            Logger.info('[DatabaseService] Database connection closed');
        }
    }

    /**
     * Check if database is connected
     */
    public isConnected(): boolean {
        return this.db !== null && this.client !== null;
    }

    /**
     * Health check - verify database connectivity
     * @returns true if database is healthy, false otherwise
     */
    public async healthCheck(): Promise<boolean> {
        try {
            if (!this.client) {
                return false;
            }
            await this.client`SELECT 1`;
            return true;
        } catch (error) {
            Logger.error('[DatabaseService] Database health check failed:', error);
            return false;
        }
    }
}

/**
 * Helper function to get database instance
 * @throws Error if database is not connected
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
    return DatabaseService.getInstance().getDb();
}
