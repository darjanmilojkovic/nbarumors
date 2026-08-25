import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE } from "@/lib/site";
import "./globals.css";

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
    <html lang="en">
      <body>
        {/* Pages supply their own <main> via WireShell. */}
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
