-- Adds a second video source (a coach-provided YouTube link) alongside the
-- existing presigned-upload path, plus clips as time ranges.
--
-- Additive only. Every existing row is an upload, so `source` defaults to
-- UPLOAD and no backfill is needed. `filename` and `mime_type` become nullable
-- because they are upload-only concepts — a YouTube record has neither — but
-- are kept, since existing upload rows still populate them.

-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('UPLOAD', 'YOUTUBE');
CREATE TYPE "ClipOrigin" AS ENUM ('MANUAL', 'GENERATED');

-- AlterTable
ALTER TABLE "videos"
  ADD COLUMN "source" "VideoSource" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "youtube_video_id" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "recording_started_at" TIMESTAMPTZ(3),
  ALTER COLUMN "filename" DROP NOT NULL,
  ALTER COLUMN "mime_type" DROP NOT NULL;

-- CreateTable
-- A clip is a range, never a file. YouTube playback is a cross-origin iframe,
-- so nothing can be cut or exported — start/end seconds is all there is.
CREATE TABLE "video_clips" (
  "id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "start_seconds" INTEGER NOT NULL,
  "end_seconds" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "event_id" TEXT,
  "origin" "ClipOrigin" NOT NULL DEFAULT 'MANUAL',
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "video_clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_clips_video_id_start_seconds_idx" ON "video_clips"("video_id", "start_seconds");
CREATE INDEX "video_clips_event_id_idx" ON "video_clips"("event_id");

-- AddForeignKey
ALTER TABLE "video_clips" ADD CONSTRAINT "video_clips_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: deleting the event does not un-happen the moment, so
-- the clip survives as an orphan range.
ALTER TABLE "video_clips" ADD CONSTRAINT "video_clips_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Range sanity enforced at the storage layer as well as in validation, so a
-- future caller that bypasses the service cannot write a backwards clip.
ALTER TABLE "video_clips" ADD CONSTRAINT "video_clips_range_check"
  CHECK ("start_seconds" >= 0 AND "end_seconds" > "start_seconds");
