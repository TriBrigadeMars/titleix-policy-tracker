-- Unsuccessful measures are not repealed laws. Add the missing lifecycle
-- states so a vetoed or failed bill keeps its own identity instead of being
-- collapsed into REPEALED.
--
-- Kept in its own migration: PostgreSQL cannot use a new enum value in the
-- same transaction that adds it.
ALTER TYPE "instrument_status" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "instrument_status" ADD VALUE IF NOT EXISTS 'VETOED';