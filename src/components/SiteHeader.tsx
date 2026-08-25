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
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:px-5 lg:col-start-2">
          <Link href="/" className="group flex items-center gap-2.5">
            <Logo className="h-8 w-8 text-body transition-colors group-hover:text-link sm:h-9 sm:w-9" />
            <span className="display text-xl leading-none sm:text-2xl">
              <span className="text-white">NBA</span>
              <span className="text-accent">Rumors</span>
            </span>
          </Link>

          {/*
           * Both slots always point at their directory. The label says where
           * you are; clicking it takes you up a level. Pointing it at the
           * current page instead made it a link that does nothing.
           */}
          <nav className="display ml-auto flex min-w-0 gap-5 text-xs text-body sm:gap-8 sm:text-base">
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
