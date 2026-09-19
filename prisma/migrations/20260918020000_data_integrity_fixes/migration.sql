-- AlterTable
ALTER TABLE "instruments" ADD COLUMN "source" TEXT,
ADD COLUMN "source_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "instruments_source_source_id_key" ON "instruments"("source", "source_id");

-- AlterTable
ALTER TABLE "instrument_notes" DROP CONSTRAINT "instrument_notes_author_id_fkey";
ALTER TABLE "instrument_notes" ALTER COLUMN "author_id" DROP NOT NULL;
ALTER TABLE "instrument_notes" ADD CONSTRAINT "instrument_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "cell_notes" DROP CONSTRAINT "cell_notes_author_id_fkey";
ALTER TABLE "cell_notes" ALTER COLUMN "author_id" DROP NOT NULL;
ALTER TABLE "cell_notes" ADD CONSTRAINT "cell_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
