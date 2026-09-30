-- 9.1 (Phase 9, store readiness). Additive only.
--   * users.terms_accepted_at / terms_version: Terms acceptance (signup tick box,
--     and the next sign-in for existing accounts).
--   * FeedbackType MESSAGE_REPORT + feedback.reported_message_id (no FK: a report
--     outlives the message it's about).
--   * user_blocks: chat blocks, removed with either account.
-- ALTER TYPE ... ADD VALUE runs in this migration's transaction; nothing here
-- uses the new value, which Postgres would refuse until it commits.

-- AlterEnum
ALTER TYPE "FeedbackType" ADD VALUE 'MESSAGE_REPORT';

-- AlterTable
ALTER TABLE "feedback" ADD COLUMN     "reported_message_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT;

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX "feedback_reported_message_id_idx" ON "feedback"("reported_message_id");

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A new table enables RLS and loses Supabase's default anon/authenticated
-- grants in its own migration (20260927221052 only covered the tables that
-- existed then). The guard lets this run on plain Postgres (CI).
ALTER TABLE "user_blocks" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "user_blocks" FROM anon, authenticated;
  END IF;
END $$;
