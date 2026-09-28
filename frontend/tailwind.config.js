/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // In the Android app the body is padded by the safe-area insets (index.css),
      // so a full-height page is the screen minus those. 0 on the web.
      minHeight: {
        screen: 'calc(100vh - var(--vv-safe-top) - var(--vv-safe-bottom))',
      },
      colors: {
        // ── Official brand palette (docs/brand/BRAND-GUIDELINES.md) ──
        // Use these names for all NEW code.
        navy: {
          900: '#111C36', // app background
          800: '#1A2745', // surface / card
          700: '#1E2D50', // primary brand navy
          600: '#2A3A63', // borders on dark
          500: '#33477A', // hover, secondary elements
          300: '#8FA0C4', // secondary text on dark
          100: '#E4E9F4', // light tints, text on navy-700
        },
        gold: {
          600: '#E09E00', // accent hover/pressed
          500: '#FFB81C', // accent — CTAs, active states
          200: '#FFE099', // accent tint
        },
        grey: {
          900: '#1A1D23',
          600: '#5A6270',
          400: '#9AA1AD',
          200: '#E2E5EA',
          50: '#F6F7F9',
        },
        // Semantic colours have three shades:
        //   DEFAULT — the fill / chart / icon colour (both modes)
        //   .dark   — brightened text variant, for use ON a dark surface
        //   .strong — darkened text variant, for use ON a light surface
        // The DEFAULT tones are tuned as fills and only reach ~3.4:1 (success)
        // and ~4.1:1 (info) as text on white, so any badge/label text sitting on
        // a light tint must use `.strong` to clear WCAG AA (4.5:1).
        success: { DEFAULT: '#2E9E5B', dark: '#4CBF7F', strong: '#1A6B3B' },
        error: { DEFAULT: '#D64545', dark: '#E86A6A', strong: '#A82F2F' },
        warning: { DEFAULT: '#E8890C', strong: '#9A5B02' },
        info: { DEFAULT: '#2B7FD4', dark: '#5FA6E8', strong: '#1B5FA8' },

        // Categorical only — carries no positive/negative meaning, unlike the
        // semantic tones above. From the brand doc's 6-colour chart sequence
        // (§2), already used as CHART_SERIES[4] in lib/chartColors.ts.
        // `strong` measures 7.9:1 on a violet/15 tint (WCAG AA needs 4.5).
        violet: { DEFAULT: '#7A5FB8', strong: '#4A3B78' },

        // ── DEPRECATED legacy aliases → light-mode brand hexes ──
        // court/spike/chalk are kept so existing classes keep working; they
        // now point at the LIGHT surface roles (light mode is the default).
        // Do not use in new code; migrate to navy/gold/grey when touching a
        // file. Do not delete — ~40 files still depend on them.
        //
        // Roles: court-* = surfaces/borders, chalk-* = text, spike-* = accent.
        // The tracking screen (/track/:matchId) stays dark and therefore must
        // NOT rely on these aliases — see components/tracking/*.
        court: {
          950: '#F6F7F9', // app canvas   (grey-50)
          900: '#FFFFFF', // card         (white)
          800: '#F6F7F9', // recessed fill / hover surface / chip (grey-50)
          700: '#E2E5EA', // border       (grey-200)
          600: '#E4E9F4', // hover accent / track fill (navy-100)
        },
        spike: { 400: '#FFB81C', 500: '#FFB81C', 600: '#E09E00' }, // gold — accent in both modes
        chalk: {
          100: '#1A1D23', // primary text   (grey-900)
          200: '#1A1D23', // emphasis text  (grey-900)
          300: '#5A6270', // secondary text (grey-600)
          400: '#5A6270', // secondary text (grey-600)
          500: '#5A6270', // secondary text (grey-600)
          600: '#9AA1AD', // muted / placeholder (grey-400)
          700: '#9AA1AD', // faint separators / tints (grey-400)
        },
      },
      fontFamily: {
        // Athletic display face for headings (brand §3)
        display: ['Barlow Semi Condensed', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // DEPRECATED alias — stats historically used font-mono; the brand uses
        // Inter with tabular figures instead (pair with the .tabular utility).
        mono: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
