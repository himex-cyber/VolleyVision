import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import teamRoutes from './routes/teams';
import playerRoutes from './routes/players';
import matchRoutes from './routes/matches';
import eventRoutes from './routes/events';
import analyticsRoutes from './routes/analytics';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import invitationRoutes from './routes/invitations';
import profileRoutes from './routes/profile';
import playerPortalRoutes from './routes/playerPortal';
import coachPortalRoutes from './routes/coachPortal';
import auditRoutes from './routes/audit';
import videoRoutes from './routes/videos';
import channelRoutes from './routes/channels';
import feedbackRoutes from './routes/feedback';
import leagueRoutes from './routes/league';
import approvalRoutes from './routes/approvals';
import trainingSessionRoutes from './routes/trainingSessions';
import { errorHandler } from './middleware/errorHandler';
import { logVideoStorageConfig } from './services/videoStorage';
import { warnIfProxyUnsupported } from './services/videoStorage/supabaseTusProxy';

dotenv.config();

// Config reporting only — both of these log and return, never throw. A video
// misconfiguration must not stop the API serving auth, matches or analytics.
logVideoStorageConfig();
warnIfProxyUnsupported();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
// Compress JSON responses (brotli where the client supports it, else gzip).
// Safe under serverless-http, which runs this app on Netlify: it treats a
// response as binary when Content-Encoding is gzip/deflate/br, so the compressed
// body is base64'd rather than mangled through a utf8 round-trip.
app.use(compression());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(morgan('dev'));
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
// All routes versioned under /api/v1 so Phase 2+ can introduce /api/v2 without
// breaking existing clients (e.g. a tablet app locked on an old version).
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/invitations', invitationRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/player', playerPortalRoutes);
app.use('/api/v1/coach', coachPortalRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/players', playerRoutes);
app.use('/api/v1/matches', matchRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1', videoRoutes);
app.use('/api/v1', channelRoutes);
app.use('/api/v1', feedbackRoutes);
app.use('/api/v1/leagues', leagueRoutes);
app.use('/api/v1/approval-requests', approvalRoutes);
app.use('/api/v1/training-sessions', trainingSessionRoutes);

// Health check — useful for deployment monitoring and CI pipelines
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'VolleyVision API', version: '1.0.0' });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// Netlify runs this module inside a serverless function (see
// backend/netlify-functions/api.js) instead of calling .listen() — Netlify
// sets its own NETLIFY env var in build and function contexts, so skip the
// local HTTP server in that case.
if (!process.env.NETLIFY) {
  app.listen(PORT, () => {
    console.log(`\n⚡ VolleyVision API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);
  });
}

export default app;
