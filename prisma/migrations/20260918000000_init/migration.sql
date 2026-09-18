-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('READER', 'EDITOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "jurisdiction_level" AS ENUM ('FEDERAL', 'STATE');

-- CreateEnum
CREATE TYPE "instrument_type" AS ENUM ('BILL', 'STATUTE', 'REGULATION');

-- CreateEnum
CREATE TYPE "instrument_status" AS ENUM ('PROPOSED', 'PASSED', 'EFFECTIVE', 'ENJOINED', 'REPEALED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verificationtokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'READER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "jurisdiction_level" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_tags" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" TEXT NOT NULL,
    "jurisdiction_id" TEXT NOT NULL,
    "type" "instrument_type" NOT NULL,
    "identifier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "instrument_status" NOT NULL,
    "introduced_at" TIMESTAMP(3),
    "passed_at" TIMESTAMP(3),
    "effective_at" TIMESTAMP(3),
    "source_url" TEXT,
    "raw_summary" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "is_title_ix_relevant" BOOLEAN NOT NULL DEFAULT false,
    "relevance_confidence" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_issue_tags" (
    "instrument_id" TEXT NOT NULL,
    "issue_tag_id" TEXT NOT NULL,

    CONSTRAINT "instrument_issue_tags_pkey" PRIMARY KEY ("instrument_id","issue_tag_id")
);

-- CreateTable
CREATE TABLE "instrument_notes" (
    "id" TEXT NOT NULL,
    "instrument_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instrument_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cell_notes" (
    "id" TEXT NOT NULL,
    "jurisdiction_id" TEXT NOT NULL,
    "issue_tag_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" VARCHAR(10000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cell_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verificationtokens_token_key" ON "verificationtokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verificationtokens_identifier_token_key" ON "verificationtokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_code_key" ON "jurisdictions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "issue_tags_slug_key" ON "issue_tags"("slug");

-- CreateIndex
CREATE INDEX "instruments_jurisdiction_id_status_idx" ON "instruments"("jurisdiction_id", "status");

-- CreateIndex
CREATE INDEX "instruments_is_title_ix_relevant_status_idx" ON "instruments"("is_title_ix_relevant", "status");

-- CreateIndex
CREATE INDEX "instruments_type_idx" ON "instruments"("type");

-- CreateIndex
CREATE INDEX "instruments_last_checked_at_idx" ON "instruments"("last_checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_jurisdiction_id_type_identifier_key" ON "instruments"("jurisdiction_id", "type", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "cell_notes_jurisdiction_id_issue_tag_id_key" ON "cell_notes"("jurisdiction_id", "issue_tag_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_issue_tags" ADD CONSTRAINT "instrument_issue_tags_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_issue_tags" ADD CONSTRAINT "instrument_issue_tags_issue_tag_id_fkey" FOREIGN KEY ("issue_tag_id") REFERENCES "issue_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_notes" ADD CONSTRAINT "instrument_notes_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_notes" ADD CONSTRAINT "instrument_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_notes" ADD CONSTRAINT "cell_notes_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_notes" ADD CONSTRAINT "cell_notes_issue_tag_id_fkey" FOREIGN KEY ("issue_tag_id") REFERENCES "issue_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cell_notes" ADD CONSTRAINT "cell_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

