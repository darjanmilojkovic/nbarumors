import Link from "next/link";

/**
 * Pages render this themselves rather than the root layout, because the label
 * on the right depends on which team or player you're looking at — something
 * a layout has no way to know.
 */
export function SiteHeader({
  teamLabel,
  teamHref,
  playerLabel,
  playerHref,
}: {
  teamLabel?: string;
  teamHref?: string;
  playerLabel?: string;
  playerHref?: string;
}) {
  return (
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

        <nav className="display ml-auto flex min-w-0 gap-5 text-xs text-body sm:gap-8 sm:text-base">
          <Link
            href={teamHref ?? "/teams"}
            className={`truncate hover:text-accent ${teamLabel ? "text-accent" : ""}`}
          >
            {teamLabel ?? "All Teams"}
          </Link>
          <Link
            href={playerHref ?? "/players"}
            className={`truncate hover:text-accent ${playerLabel ? "text-accent" : ""}`}
          >
            {playerLabel ?? "All Players"}
          </Link>
        </nav>
      </div>
    </header>
  );
}
