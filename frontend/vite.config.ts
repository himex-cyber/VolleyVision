import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Sentry source-map upload only runs when SENTRY_AUTH_TOKEN is set (a Netlify
// build env var, never committed) so local/CI builds without it behave
// exactly as before. filesToDeleteAfterUpload removes the generated .map
// files post-upload so maps reach Sentry but never ship on the public site.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    sentryAuthToken &&
      sentryVitePlugin({
        org: 'himex-cyber',
        project: process.env.SENTRY_PROJECT || 'volleyvision',
        authToken: sentryAuthToken,
        sourcemaps: {
          filesToDeleteAfterUpload: ['**/*.js.map'],
        },
      }),
  ],
  build: {
    sourcemap: sentryAuthToken ? 'hidden' : false,
    rollupOptions: {
      output: {
        // recharts is heavy and used by only 7 files (charts + analytics panels),
        // so it gets its own chunk that's fetched only when a charting page opens.
        //
        // Tagged by module id rather than the `{ recharts: ['recharts'] }` object
        // form on purpose: that form drags a chunk's whole dependency subtree in
        // with it. Anything shared between the eager app and recharts therefore
        // has to be claimed first — left untagged, react/react-dom and clsx both
        // got absorbed, which preloaded the 119 kB chart chunk on every page and
        // made /register pull it in just to use a class-name helper.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|clsx)[\\/]/.test(id)) {
            return 'vendor';
          }
          if (/[\\/]node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+|internmap|robust-predicates|delaunator|@reduxjs[\\/]toolkit|react-redux|reselect|immer|es-toolkit|decimal\.js-light)[\\/]/.test(id)) {
            return 'recharts';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
