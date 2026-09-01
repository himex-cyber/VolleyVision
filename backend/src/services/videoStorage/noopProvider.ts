// The default provider. Every method fails with the same clean 503.
//
// This is what keeps the app bootable with zero video env vars set: the video
// routes are mounted unconditionally by index.ts, so an unconfigured install
// must still serve auth, matches, analytics and chat normally and fail only
// where video is actually touched.

import { AppError } from '../../middleware/errorHandler';
import type { VideoStorageProvider } from './types';

function unconfigured(): never {
  throw new AppError(503, 'Video storage is not configured.');
}

export const noopProvider: VideoStorageProvider = {
  name: 'none',
  createPresignedUpload: async () => unconfigured(),
  getPlaybackSource: async () => unconfigured(),
  delete: async () => unconfigured(),
  head: async () => unconfigured(),
};
