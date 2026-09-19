-- `triage_status` is the single source of truth for Title IX relevance.
-- `is_title_ix_relevant` was backfilled into it by
-- 20260918010000_add_triage_status and every reader now derives relevance from
-- the enum, so the redundant boolean and its index are dropped.
DROP INDEX "instruments_is_title_ix_relevant_status_idx";

ALTER TABLE "instruments" DROP COLUMN "is_title_ix_relevant";