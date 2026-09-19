-- CreateEnum
CREATE TYPE "triage_status" AS ENUM ('UNREVIEWED', 'RELEVANT', 'NOT_RELEVANT');

-- AlterTable
ALTER TABLE "instruments" ADD COLUMN "triage_status" "triage_status" NOT NULL DEFAULT 'UNREVIEWED';

-- Migrate existing rows
UPDATE "instruments"
SET "triage_status" = CASE
  WHEN "is_title_ix_relevant" = true THEN 'RELEVANT'::"triage_status"
  WHEN "is_title_ix_relevant" = false AND "relevance_confidence" IS NOT NULL THEN 'NOT_RELEVANT'::"triage_status"
  ELSE 'UNREVIEWED'::"triage_status"
END;

-- CreateIndex
CREATE INDEX "instruments_triage_status_status_idx" ON "instruments"("triage_status", "status");
