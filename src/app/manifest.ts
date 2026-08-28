import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * The web app manifest, served at /manifest.webmanifest.
 *
 * A .ico and a rel=icon link only cover the browser tab. This is what Android
 * reads when someone adds the site to their home screen; without it that
 * shortcut falls back to a screenshot of the page.
 *
 * Colours are the pack's own #071525 rather than the page's #0d0d0d. They
 * differ, but this is the colour the artwork was drawn against, and it is what
 * paints the Android address bar and the splash screen behind the icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — Trades, Signings & Player Movement`,
    short_name: SITE.name,
    description:
      "Every NBA trade rumor, signing and player move, gathered from around the league and updated through the day.",
    start_url: "/",
    display: "standalone",
    theme_color: "#071525",
    background_color: "#071525",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      /*
       * Generated, not shipped in the pack: a maskable icon is cropped to
       * whatever shape the launcher likes, and the full-bleed artwork would
       * lose its flame tips at the corners.
       */
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
