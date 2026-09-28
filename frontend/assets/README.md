Android icon and splash sources (Phase 5). From the reversed brand mark in
`docs/brand/brand-assets/volleyvision-icon-reversed.svg`: white ball and gold
arrow on navy-900 (#111C36). The regular mark's navy ball would vanish on a
navy background.

Regenerate after changing `src/*.svg`:

    npx @resvg/resvg-js-cli@2.6.2-beta.1 --fit-width 1024 src/fg.svg icon-foreground.png
    npx @resvg/resvg-js-cli@2.6.2-beta.1 --fit-width 1024 src/bg.svg icon-background.png
    npx @resvg/resvg-js-cli@2.6.2-beta.1 --fit-width 1024 src/only.svg icon-only.png
    npx @resvg/resvg-js-cli@2.6.2-beta.1 --fit-width 2732 src/splash.svg splash.png   (copy to splash-dark.png)
    cd .. && npx @capacitor/assets@3.0.5 generate --android --iconBackgroundColor "#111C36" --iconBackgroundColorDark "#111C36" --splashBackgroundColor "#111C36" --splashBackgroundColorDark "#111C36"

The foreground keeps the mark inside Android's adaptive-icon safe zone (60% of
the canvas). @capacitor/assets rewrites AndroidManifest.xml's formatting; revert
that file afterwards.
