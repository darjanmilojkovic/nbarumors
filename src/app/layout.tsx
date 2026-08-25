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
  variable: "--font-sans-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NBA Rumors — Trades, Signings & Player Movement",
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
