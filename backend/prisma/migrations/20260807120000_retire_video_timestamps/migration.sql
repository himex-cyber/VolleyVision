-- Retire VideoTimestamp in favour of VideoClip.
--
-- Two models meant "a moment in a video": VideoTimestamp (a single point) and
-- VideoClip (a range, with origin and an event link). Two overlapping models
-- for one concept drift apart, and the range is what reviewing a rally actually
-- needs — you cannot watch a point in time.
--
-- Data is preserved, not discarded. Each timestamp becomes a 15-second clip
-- starting at the marked instant: a coach tagged that moment because something
-- there mattered, and 15 s is enough to see it resolve. origin = MANUAL because
-- a human placed it by hand, which is exactly what MANUAL means — and it also
-- means recalibration will not sweep these away with the GENERATED ones.
--
-- Idempotent by construction. The copy is guarded on video_timestamps still
-- existing, so a re-run after the DROP finds nothing to do rather than failing.
-- The whole migration is one transaction: either the rows move and the table
-- goes, or neither happens.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'video_timestamps'
  ) THEN
    INSERT INTO "video_clips" (
      "id", "video_id", "start_seconds", "end_seconds",
      "label", "event_id", "origin", "created_by_user_id", "created_at"
    )
    SELECT
      vt."id",
      vt."video_id",
      vt."timestamp_seconds",
      vt."timestamp_seconds" + 15,
      vt."label",
      vt."event_id",
      'MANUAL'::"ClipOrigin",
      -- VideoTimestamp never recorded an author. Attributing to the video's
      -- uploader is the only honest answer available: they owned the footage
      -- the marker was placed on.
      v."uploaded_by_user_id",
      NOW()
    FROM "video_timestamps" vt
    JOIN "videos" v ON v."id" = vt."video_id"
    -- Reusing the timestamp's own id as the clip id makes the copy naturally
    -- idempotent: a second run collides and skips rather than duplicating.
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;

-- DropTable
DROP TABLE IF EXISTS "video_timestamps";
