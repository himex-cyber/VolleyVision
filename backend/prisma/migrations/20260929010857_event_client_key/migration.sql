-- AlterTable
ALTER TABLE "events" ADD COLUMN "client_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "events_match_id_client_key_key" ON "events"("match_id", "client_key");
