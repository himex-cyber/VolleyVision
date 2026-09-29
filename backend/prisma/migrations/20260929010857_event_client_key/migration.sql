-- AlterTable
ALTER TABLE "events" ADD COLUMN "client_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "events_match_id_client_key_key" ON "events"("match_id", "client_key");

-- CreateIndex
CREATE INDEX "events_match_id_recorded_at_idx" ON "events"("match_id", "recorded_at");
