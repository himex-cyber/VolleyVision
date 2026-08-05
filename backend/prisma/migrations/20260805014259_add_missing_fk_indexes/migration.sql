-- CreateIndex
CREATE INDEX "approval_requests_requested_by_id_idx" ON "approval_requests"("requested_by_id");

-- CreateIndex
CREATE INDEX "approval_requests_resolved_by_id_idx" ON "approval_requests"("resolved_by_id");

-- CreateIndex
CREATE INDEX "league_matches_home_match_id_idx" ON "league_matches"("home_match_id");

-- CreateIndex
CREATE INDEX "league_matches_away_match_id_idx" ON "league_matches"("away_match_id");

-- CreateIndex
CREATE INDEX "matches_team_id_idx" ON "matches"("team_id");

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "teams_league_season_id_idx" ON "teams"("league_season_id");

-- CreateIndex
CREATE INDEX "teams_owner_id_idx" ON "teams"("owner_id");

-- CreateIndex
CREATE INDEX "training_sessions_created_by_user_id_idx" ON "training_sessions"("created_by_user_id");

-- CreateIndex
CREATE INDEX "video_timestamps_event_id_idx" ON "video_timestamps"("event_id");
