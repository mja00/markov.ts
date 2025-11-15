/**
 * Database migration script
 * Run this script to apply pending migrations to the database
 *
 * Usage: npm run build && node dist/scripts/migrate.js
 */

import 'dotenv/config';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { Logger } from '../services/logger.js';

const runMigrations = async (): Promise<void> => {
    Logger.info('[Migrations] Starting database migrations...');

    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        Logger.error('[Migrations] DATABASE_URL environment variable is not set');
        process.exit(1);
    }

    // Create connection for migrations
    const migrationClient = postgres(connectionString, { max: 1 });

    try {
        Logger.info('[Migrations] Connecting to database...');

        const db = drizzle(migrationClient);

        Logger.info('[Migrations] Running migrations from ./drizzle folder...');
        await migrate(db, { migrationsFolder: './drizzle' });

        Logger.info('[Migrations] ✅ All migrations completed successfully!');
    } catch (error) {
        Logger.error('[Migrations] Migration failed:', error);
        process.exit(1);
    } finally {
        await migrationClient.end();
        Logger.info('[Migrations] Database connection closed');
    }
};

// Run migrations
runMigrations();
