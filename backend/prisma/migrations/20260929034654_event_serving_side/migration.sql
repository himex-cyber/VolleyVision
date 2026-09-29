-- CreateEnum
CREATE TYPE "ServingSide" AS ENUM ('US', 'THEM');

-- AlterTable
ALTER TABLE "events" ADD COLUMN "serving_side" "ServingSide";
