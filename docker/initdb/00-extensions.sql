-- Runs once, on first boot of an empty data volume (Postgres initdb hook).
-- The memories table uses a vector(1536) column + HNSW index, so the pgvector
-- extension must exist before the schema is pushed.
CREATE EXTENSION IF NOT EXISTS vector;
