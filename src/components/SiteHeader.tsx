import Link from "next/link";
import { Logo } from "@/components/Logo";

/**
 * Pages render this themselves rather than the root layout, because the label
 * on the right depends on which team or player you're looking at — something
 * a layout has no way to know.
 *
 * The inner grid mirrors WireShell's so the lockup sits above the main column
 * on desktop rather than floating out over the left rail.
 *
 * From xl the row spans the right rail as well. It is the labels that force
 * this: "Minnesota Timberwolves" beside "Giannis Antetokounmpo" needs 798px,
 * and the middle column alone offers 654 — so the nav wrapped to a second line
 * and the header grew from 90px to 122px. Worse, that only happened on WIDE
 * screens, because the right rail appears at xl and takes 300px away from the
 * column the header was confined to; a 1200px laptop was fine and a 1440px
 * monitor was not. Spanning it costs nothing, since the rail is empty at this
 * height, and the lockup does not move — only the right edge does.
 */
export function SiteHeader({
  teamLabel,
  playerLabel,
}: {
  teamLabel?: string;
  playerLabel?: string;
}) {
  return (
    <header className="border-b-2 border-rule bg-ink">
      {/* Same outer padding and column template as WireShell, and the same
          inner padding as a WireItem, so the lockup lines up with the cards. */}
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 px-0 sm:px-5 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/*
         * Two different shapes. On a phone there is no room for a lockup and
         * two labels on one line, so the header stacks and centres: masthead
         * on top, nav beneath it. From sm up it returns to a single row with
         * the lockup left and the nav pushed right, which is what lines it up
         * with the column of cards below.
         */}
        <div className="flex flex-col items-center gap-3 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2 sm:border-l sm:border-transparent sm:px-5 lg:col-start-2 xl:col-end-4">
          <Link href="/" className="group flex items-center gap-2.5">
            <Logo className="h-12 w-12 transition-transform duration-200 group-hover:scale-105 sm:h-14 sm:w-14" />
            <span className="label text-3xl leading-none font-semibold sm:text-2xl">
              <span className="text-white transition-colors group-hover:text-link">
                NBA
              </span>
              <span className="text-accent">Rumors</span>
            </span>
          </Link>

          {/*
           * Both slots always point at their directory. The label says where
           * you are; clicking it takes you up a level. Pointing it at the
           * current page instead made it a link that does nothing.
           */}
          <nav className="label flex w-full min-w-0 justify-center gap-6 text-sm text-body sm:ml-auto sm:w-auto sm:justify-end sm:gap-8 sm:text-base">
            <Link
              href="/teams"
              title={teamLabel ? "Back to all teams" : undefined}
              className={`truncate hover:text-link ${teamLabel ? "text-link" : ""}`}
            >
              {teamLabel ?? "All Teams"}
            </Link>
            <Link
              href="/players"
              title={playerLabel ? "Back to all players" : undefined}
              className={`truncate hover:text-link ${playerLabel ? "text-link" : ""}`}
            >
              {playerLabel ?? "All Players"}
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
