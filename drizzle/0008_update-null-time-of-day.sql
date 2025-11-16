-- Custom SQL migration file, put your code below! --

-- Data migration: Convert NULL time_of_day values to 'ANY' for consistency
-- This handles legacy catchables that existed before the time-based fishing feature
-- Ensures all catchables have explicit time_of_day values instead of NULL

UPDATE catchables SET time_of_day = 'ANY' WHERE time_of_day IS NULL;
