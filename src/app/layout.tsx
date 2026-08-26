import type { Metadata } from "next";
import { Noto_Sans, Noto_Serif } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE } from "@/lib/site";
import "./globals.css";

/*
 * Self-hosted by next/font: the files are served from our own origin, so there
 * is no request to Google and no flash of unstyled text.
 *
 * This replaces a stack that asked for Futura and Jost without ever loading
 * either. Neither ships with Windows or Android, so in practice every headline
 * on the site was rendering in whatever generic sans the visitor happened to
 * have — the typography was decorative CSS that never applied.
 */
const serif = Noto_Serif({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-serif-loaded",
  display: "swap",
});

const sans = Noto_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  /*
   * Italic is loaded rather than synthesised. Body copy is sans, and quoted
   * speech is set in italic to mark it as someone speaking — a browser-faked
   * oblique is a slanted regular, which at this size reads as a rendering
   * fault rather than a change of voice.
   */
  style: ["normal", "italic"],
  variable: "--font-sans-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  /*
   * The template supplies the suffix, so each page sets only what identifies
   * it: a headline, a team, a player. Without it every route inherited this
   * one string, and a browser tab full of posts read "NBA Rumors — Trades,
   * Signings & Player Movement" nine times over.
   */
  title: {
    default: "NBA Rumors — Trades, Signings & Player Movement",
    template: `%s — ${SITE.name}`,
  },
  description:
    "Every NBA trade rumor, signing and player move, gathered from around the league and updated through the day.",
  metadataBase: new URL(SITE.url),
  alternates: { canonical: "/" },
  openGraph: {
    siteName: SITE.name,
    type: "website",
    url: SITE.url,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        {/* Pages supply their own <main> via WireShell. */}
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
