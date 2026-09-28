import type { CapacitorConfig } from '@capacitor/cli';

// CAP_ENV=local is set only by `npm run android:local` (scripts/android.mjs):
// the emulator reaches the PC's API over plain http://10.0.2.2:3001, which
// Android blocks unless cleartext is allowed. A prod sync never sets it, and
// scripts/check-android-prod.mjs fails a release build that has either flag.
const local = process.env.CAP_ENV === 'local';

const config: CapacitorConfig = {
  appId: 'app.volleyvision',
  appName: 'VolleyVision',
  webDir: 'dist',
  ...(local ? { server: { cleartext: true }, android: { allowMixedContent: true } } : {}),
  plugins: {
    // Capacitor 8's core SystemBars: newer Android draws the app under the
    // status and gesture bars, and 'css' hands us --safe-area-inset-* values
    // to pad the header and bottom controls with. The app is light-only, so
    // the bar icons stay dark even when the phone is in dark mode.
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover', style: 'LIGHT' },
  },
};

export default config;
