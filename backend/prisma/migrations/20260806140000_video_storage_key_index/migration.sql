-- The TUS resumable-upload proxy authorizes every chunk by resolving the video
-- row from the storage key carried in the request. Chunks are 6 MB, so a 1 GB
-- upload performs ~170 of these lookups; without an index each one is a
-- sequential scan of the whole table.

-- CreateIndex
CREATE INDEX "videos_storage_key_idx" ON "videos"("storage_key");
