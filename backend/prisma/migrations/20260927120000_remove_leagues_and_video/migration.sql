-- Leagues and match video were removed from the app on 2026-09-27 to shrink the
-- beta to a cleaner core (see docs/audit/AUDIT-LOG.md). Karlos confirmed no
-- production data in these tables was worth keeping. Both features may return
-- later: restore from git tag `pre-feature-removal`, and write a new migration
-- rather than reverting this one.

-- DropForeignKey
ALTER TABLE "teams" DROP CONSTRAINT "teams_league_season_id_fkey";

-- DropForeignKey
ALTER TABLE "videos" DROP CONSTRAINT "videos_match_id_fkey";

-- DropForeignKey
ALTER TABLE "video_clips" DROP CONSTRAINT "video_clips_video_id_fkey";

-- DropForeignKey
ALTER TABLE "video_clips" DROP CONSTRAINT "video_clips_event_id_fkey";

-- DropForeignKey
ALTER TABLE "leagues" DROP CONSTRAINT "leagues_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "league_seasons" DROP CONSTRAINT "league_seasons_league_id_fkey";

-- DropForeignKey
ALTER TABLE "league_teams" DROP CONSTRAINT "league_teams_league_season_id_fkey";

-- DropForeignKey
ALTER TABLE "league_teams" DROP CONSTRAINT "league_teams_team_id_fkey";

-- DropForeignKey
ALTER TABLE "league_matches" DROP CONSTRAINT "league_matches_league_season_id_fkey";

-- DropForeignKey
ALTER TABLE "league_matches" DROP CONSTRAINT "league_matches_home_league_team_id_fkey";

-- DropForeignKey
ALTER TABLE "league_matches" DROP CONSTRAINT "league_matches_away_league_team_id_fkey";

-- DropForeignKey
ALTER TABLE "league_matches" DROP CONSTRAINT "league_matches_home_match_id_fkey";

-- DropForeignKey
ALTER TABLE "league_matches" DROP CONSTRAINT "league_matches_away_match_id_fkey";

-- DropIndex
DROP INDEX "teams_league_season_id_idx";

-- AlterTable
ALTER TABLE "teams" DROP COLUMN "league_season_id";

-- DropTable
DROP TABLE "videos";

-- DropTable
DROP TABLE "video_clips";

-- DropTable
DROP TABLE "leagues";

-- DropTable
DROP TABLE "league_seasons";

-- DropTable
DROP TABLE "league_teams";

-- DropTable
DROP TABLE "league_matches";

-- DropEnum
DROP TYPE "VideoStatus";

-- DropEnum
DROP TYPE "VideoSource";

-- DropEnum
DROP TYPE "ClipOrigin";

