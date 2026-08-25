import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NBA Rumors — Trades, Signings & Player Movement",
  description:
    "Every NBA trade rumor, signing and player move, gathered from around the league and updated through the day.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {/* Pages supply their own <main> via WireShell. */}
        {children}

        <footer className="mx-auto max-w-[1280px] px-4 pt-4 pb-10 text-xs text-muted sm:px-6">
          <p>
            Rumors are summarized in our own words from public reporting, with a link
            to the original source. Team logos and marks belong to their respective
            owners. Player photos are used under their stated licenses.
          </p>
        </footer>
      </body>
    </html>
  );
}
