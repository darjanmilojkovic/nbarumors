import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * The web app manifest, served at /manifest.webmanifest.
 *
 * This exists so the icons supplied in the favicon set are actually reachable
 * where a browser looks for them. A .ico and an <link rel="icon"> cover the
 * tab; the manifest is what Android uses when someone adds the site to their
 * home screen, and without it that shortcut falls back to a screenshot of the
 * page.
 *
 * The colours are the site's, not the ones the icon generator emitted. Its
 * defaults were a blue theme on a white background, which would paint the
 * Android address bar and the splash screen in a palette that appears nowhere
 * on the site. theme_color is the masthead; background_color is the page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — Trades, Signings & Player Movement`,
    short_name: SITE.name,
    description:
      "Every NBA trade rumor, signing and player move, gathered from around the league and updated through the day.",
    start_url: "/",
    display: "standalone",
    theme_color: "#0d0d0d",
    background_color: "#0d0d0d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
