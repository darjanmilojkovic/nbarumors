import Link from "next/link";
import { Logo } from "@/components/Logo";

/**
 * Pages render this themselves rather than the root layout, because the label
 * on the right depends on which team or player you're looking at — something
 * a layout has no way to know.
 *
 * The inner grid mirrors WireShell's so the lockup and nav sit above the main
 * column on desktop rather than floating out over the left rail.
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
        <div className="flex flex-col items-center gap-3 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2 sm:px-5 lg:col-start-2">
          <Link href="/" className="group flex items-center gap-2.5">
            <Logo className="h-11 w-11 text-body transition-colors group-hover:text-link sm:h-9 sm:w-9" />
            <span className="display text-3xl leading-none sm:text-2xl">
              <span className="text-white">NBA</span>
              <span className="text-accent">Rumors</span>
            </span>
          </Link>

          {/*
           * Both slots always point at their directory. The label says where
           * you are; clicking it takes you up a level. Pointing it at the
           * current page instead made it a link that does nothing.
           */}
          <nav className="display flex w-full min-w-0 justify-center gap-6 text-sm text-body sm:ml-auto sm:w-auto sm:justify-end sm:gap-8 sm:text-base">
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
