import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        // Planetscale/PostgreSQL supports connection string
        url: process.env.DATABASE_URL || '',
    },
    migrations: {
        // Use public schema instead of creating a drizzle schema
        schema: 'public',
    },
    schemaFilter: ['public'],
});
