-- Custom SQL migration file, put your code below! --

-- Add index on (rarity, time_of_day) for optimized fishing queries
-- This improves performance of the pickCatchableByRarity query
-- which filters by both rarity and time_of_day frequently
CREATE INDEX IF NOT EXISTS idx_catchables_rarity_time ON catchables(rarity, time_of_day);
