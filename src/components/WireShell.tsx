import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import {
  activeTeams,
  beatCounts,
  mostMentioned,
  recentlyDone,
  wireStats,
} from "@/lib/queries";

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

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="display mb-3 text-[11px] font-bold tracking-[0.13em] text-muted">
      {children}
    </h2>
  );
}

async function LeftRail({ teamSlug }: { teamSlug?: string }) {
  const [beats, teams, stats] = await Promise.all([
    beatCounts(),
    activeTeams(),
    wireStats(),
  ]);

  return (
    <aside className="sticky top-4 hidden py-6 pr-5 lg:block">
      <RailHeading>Beats</RailHeading>
      <nav className="mb-7 flex flex-col gap-px">
        <Link
          href="/"
          className="flex items-center justify-between rounded-sm px-3 py-2 text-sm text-body hover:bg-surface hover:text-white"
        >
          All Rumors
          <span className="font-mono text-[11px] text-muted">
            {stats?.rumorCount ?? 0}
          </span>
        </Link>
        {beats.map((b) => (
          <Link
            key={b.type}
            href={`/?cat=${b.type}`}
            className="flex items-center justify-between rounded-sm px-3 py-2 text-sm text-body hover:bg-surface hover:text-white"
          >
            {BEAT_LABEL[b.type] ?? b.type}
            <span className="font-mono text-[11px] text-muted">{b.n}</span>
          </Link>
        ))}
      </nav>

      <RailHeading>Most active</RailHeading>
      <div className="mb-7 flex flex-wrap gap-1.5">
        {teams.map((t) => (
          <Link
            key={t.slug}
            href={`/team/${t.slug}`}
            aria-pressed={teamSlug === t.slug}
            className={`rounded-sm border px-2 py-1 font-mono text-[11px] tracking-wider ${
              teamSlug === t.slug
                ? "border-link bg-link font-bold text-white"
                : "border-rule bg-surface text-body hover:border-link hover:text-white"
            }`}
          >
            {t.abbreviation}
          </Link>
        ))}
      </div>

      {/* Real counters, in place of the concept's invented cap sheet. */}
      <div className="rounded-sm border border-rule bg-surface p-3.5">
        <div className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
          Tracking now
        </div>
        <div className="display my-1 text-4xl leading-none tabular-nums">
          {stats?.rumorCount ?? 0}
          <i className="text-accent not-italic">·</i>
        </div>
        <div className="text-xs text-muted">
          {stats?.corroborated ?? 0} corroborated · {stats?.playerCount ?? 0} players
          <br />
          {stats?.outletCount ?? 0} outlets monitored
        </div>
      </div>
    </aside>
  );
}

async function RightRail() {
  const [players, done] = await Promise.all([mostMentioned(), recentlyDone()]);

  return (
    <aside className="sticky top-4 hidden border-l border-rule py-6 pl-5 xl:block">
      <section className="mb-5 overflow-hidden rounded-sm border border-rule bg-surface">
        <div className="flex items-baseline justify-between border-b border-rule px-3.5 py-2.5">
          <h3 className="display text-xs font-bold tracking-[0.12em]">
            Most mentioned
          </h3>
          <span className="font-mono text-[10px] text-muted">7d</span>
        </div>
        {players.length === 0 ? (
          <p className="px-3.5 py-4 text-xs text-muted">Nothing this week.</p>
        ) : (
          players.map((p) => (
            <Link
              key={p.slug}
              href={`/player/${p.slug}`}
              className="flex items-center gap-2.5 border-b border-rule px-3.5 py-2.5 last:border-b-0 hover:bg-surface-2"
            >
              {p.headshotUrl ? (
                <Image
                  src={p.headshotUrl}
                  alt=""
                  width={64}
                  height={47}
                  className="h-8 w-8 shrink-0 rounded-full bg-surface-2 object-cover object-top"
                  unoptimized
                />
              ) : (
                <span className="h-8 w-8 shrink-0 rounded-full bg-surface-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {p.fullName}
                </span>
                <span className="block font-mono text-[10px] text-muted">
                  {p.mentions} report{p.mentions === 1 ? "" : "s"}
                </span>
              </span>
            </Link>
          ))
        )}
      </section>

      <section className="mb-5 overflow-hidden rounded-sm border border-rule bg-surface">
        <div className="flex items-baseline justify-between border-b border-rule px-3.5 py-2.5">
          <h3 className="display text-xs font-bold tracking-[0.12em]">Done deals</h3>
          <span className="font-mono text-[10px] text-muted">Latest</span>
        </div>
        {done.map((d) => (
          <Link
            key={d.slug}
            href={`/rumor/${d.slug}`}
            className="block border-b border-rule px-3.5 py-2.5 text-[13px] leading-snug last:border-b-0 hover:bg-surface-2"
          >
            {d.headline}
          </Link>
        ))}
      </section>

      <p className="px-1 font-mono text-[10.5px] leading-relaxed text-muted">
        Every item is summarized in our own words from public reporting and links
        back to its source.
      </p>
    </aside>
  );
}

/**
 * The three-column shell. Every page renders this, which is also what keeps
 * the masthead present on individual rumor pages.
 */
export function WireShell({
  children,
  teamLabel,
  teamHref,
  playerLabel,
  playerHref,
  teamSlug,
}: {
  children: React.ReactNode;
  teamLabel?: string;
  teamHref?: string;
  playerLabel?: string;
  playerHref?: string;
  teamSlug?: string;
}) {
  return (
    <>
      <SiteHeader
        teamLabel={teamLabel}
        teamHref={teamHref}
        playerLabel={playerLabel}
        playerHref={playerHref}
      />
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-start px-0 sm:px-5 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        <LeftRail teamSlug={teamSlug} />
        <main className="min-h-screen">{children}</main>
        <RightRail />
      </div>
    </>
  );
}
