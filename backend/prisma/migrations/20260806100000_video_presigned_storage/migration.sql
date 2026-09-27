-- Match video storage: from on-disk multer uploads to presigned
-- direct-to-storage uploads with a server-verified lifecycle.
--
-- Additive only. `file_path` is kept (nullable) so pre-migration rows survive;
-- their bytes are gone with the ephemeral container that held them, so playback
-- returns 410 rather than crashing.

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "videos"
  ALTER COLUMN "file_path" DROP NOT NULL,
  ADD COLUMN "storage_provider" TEXT,
  ADD COLUMN "storage_key" TEXT,
  ADD COLUMN "status" "VideoStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "size_bytes" INTEGER,
  ADD COLUMN "duration_seconds" INTEGER;

-- Every row that exists at this point predates presigned upload and completed
-- its (disk) upload as far as the old code was concerned. Mark them READY so
-- they keep appearing on the match page; the null storage_key is what makes
-- playback 410 with a specific message instead of silently failing.
UPDATE "videos" SET "status" = 'READY';

-- CreateIndex
CREATE INDEX "videos_match_id_status_idx" ON "videos"("match_id", "status");
