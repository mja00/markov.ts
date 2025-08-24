export default {
    schema: './src/db/schema.ts',
    out: './drizzle',
    driver: 'pg',
    dbCredentials: {
        host: process.env.host,
        port: Number(process.env.port),
        user: process.env.user,
        password: process.env.password,
        database: process.env.database,
    },
};
