import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
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
