import Link from "next/link";
import { beatCounts, wireStats } from "@/lib/queries";

const BEAT_LABEL: Record<string, string> = {
  trade: "Trade Machine",
  signing: "Signings",
  free_agency: "Free Agency",
  extension: "Extensions",
  buyout: "Buyout Market",
  waiver: "Waivers",
  draft: "Draft",
  injury_impact: "Injury Room",
  other: "Other",
};

/**
 * Paper masthead. Beats are promoted out of a left rail and into the header,
 * which is what lets the page run on a single content column plus one rail.
 *
 * Pages render this themselves rather than the root layout, because the label
 * on the right depends on which team or player you're looking at — something
 * a layout has no way to know.
 */
export async function SiteHeader({
  teamLabel,
  teamHref,
  playerLabel,
  playerHref,
  activeBeat,
}: {
  teamLabel?: string;
  teamHref?: string;
  playerLabel?: string;
  playerHref?: string;
  activeBeat?: string;
}) {
  const [beats, stats] = await Promise.all([beatCounts(), wireStats()]);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <header className="border-b border-line bg-ground">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-end gap-4 px-5 pt-5 pb-3.5 sm:px-6">
        <Link href="/">
          <div className="display text-[28px] leading-[0.9] font-bold sm:text-[34px]">
            NBA<span className="text-accent">Rumors</span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] tracking-[0.22em] text-muted uppercase">
            Trades · Signings · Player Movement
          </div>
        </Link>

        <div className="ml-auto flex items-center gap-4">
          <div className="hidden text-right font-mono text-[10.5px] leading-[1.7] tracking-wider text-muted uppercase sm:block">
            {today}
            <b className="block font-semibold tracking-wide text-ink">
              {stats?.rumorCount ?? 0} items in the mill
            </b>
          </div>
          {/* Contextual slots: the team/player you're currently viewing. */}
          <nav className="display flex min-w-0 gap-4 text-[11px] tracking-widest sm:text-xs">
            <Link
              href={teamHref ?? "/teams"}
              className={`truncate hover:text-accent ${teamLabel ? "text-accent" : "text-ink-2"}`}
            >
              {teamLabel ?? "All Teams"}
            </Link>
            <Link
              href={playerHref ?? "/players"}
              className={`truncate hover:text-accent ${playerLabel ? "text-accent" : "text-ink-2"}`}
            >
              {playerLabel ?? "All Players"}
            </Link>
          </nav>
        </div>
      </div>

      {/* beats */}
      <nav className="border-t border-line">
        <div className="no-scrollbar mx-auto flex max-w-[1160px] gap-6 overflow-x-auto px-5 sm:px-6">
          <Link
            href="/"
            aria-current={!activeBeat ? "page" : undefined}
            className={`display flex items-center gap-1.5 border-b-2 py-3 text-[12.5px] font-bold tracking-[0.1em] whitespace-nowrap ${
              !activeBeat
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            Rumor Mill
            <i className="font-mono text-[10px] font-normal tracking-normal text-muted not-italic">
              {stats?.rumorCount ?? 0}
            </i>
          </Link>
          {beats.map((b) => (
            <Link
              key={b.type}
              href={`/?cat=${b.type}`}
              aria-current={activeBeat === b.type ? "page" : undefined}
              className={`display flex items-center gap-1.5 border-b-2 py-3 text-[12.5px] font-bold tracking-[0.1em] whitespace-nowrap ${
                activeBeat === b.type
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {BEAT_LABEL[b.type] ?? b.type}
              <i className="font-mono text-[10px] font-normal tracking-normal text-muted not-italic">
                {b.n}
              </i>
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
