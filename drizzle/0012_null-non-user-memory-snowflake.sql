-- Custom SQL migration file, put your code below! --

-- Backfill: prior to this change saveMemory() stamped SERVER/QUOTE memories with
-- the caller's user_snowflake. That let user-scoped delete APIs remove them,
-- bypassing the Manage Server admin gate, and leaked them into a user's personal
-- list. Going forward only USER memories carry a user_snowflake; clear the column
-- for any existing non-USER rows so they match the new invariant.
UPDATE "memories" SET "user_snowflake" = NULL WHERE "scope" <> 'USER' AND "user_snowflake" IS NOT NULL;
