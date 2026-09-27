-- Phase 2 of the 2026-09 audit (docs/audit/AUDIT-LOG.md).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verification_expires_at" TIMESTAMP(3),
ADD COLUMN     "email_verification_token_hash" TEXT,
ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;


-- Exactly one HEAD_COACH per team (Karlos, 2026-09-27). The app guards this
-- too; the index is the backstop against a race or a future code path that
-- forgets. Checked on production before writing: no team violates it.
CREATE UNIQUE INDEX "team_memberships_one_head_coach" ON "team_memberships"("team_id") WHERE "role" = 'HEAD_COACH';
