import type { Metadata } from "next";
import Link from "next/link";
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
        <header className="border-b-2 border-rule bg-ink">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:px-6">
            <Link href="/" className="display flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-9 w-9 place-items-center rounded-sm bg-accent text-lg"
              >
                🏀
              </span>
              <span className="text-xl text-white sm:text-2xl">NBA Rumors</span>
            </Link>
            <nav className="display ml-auto flex gap-5 text-xs text-body sm:gap-8 sm:text-base">
              <Link href="/teams" className="hover:text-accent">
                All Teams
              </Link>
              <Link href="/" className="hover:text-accent">
                All Updates
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-0 py-6 sm:px-6 sm:py-10">{children}</main>

        <footer className="mx-auto max-w-4xl px-4 pt-4 pb-10 text-xs text-muted sm:px-6">
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
