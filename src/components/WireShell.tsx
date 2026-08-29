import Image from "next/image";
import Link from "next/link";
import { RevealHeader } from "@/components/RevealHeader";
import { SearchBox } from "@/components/SearchBox";
import { SiteHeader } from "@/components/SiteHeader";
import {
  activeTeams,
  beatCounts,
  mostMentioned,
  recentlyDone,
  wireStats,
} from "@/lib/queries";

const BEAT_LABEL: Record<string, string> = {
  trade: "Trade Rumors",
  signing: "Contract Signings",
  free_agency: "Free Agency",
  extension: "Contract Extensions",
  buyout: "Buyout Market",
  waiver: "Waivers",
  draft: "NBA Draft",
  injury_impact: "Injury Room",
  other: "Other",
};

/**
 * Beats that exist in the data but are not offered as a way in.
 *
 * "Other" is the extraction's fallback bucket rather than a subject anyone
 * comes looking for, and a nav item named after our own leftovers invites a
 * click that cannot satisfy it.
 *
 * Hidden from the rail, not deleted: the posts keep their type, still appear
 * under Latest Updates, and `/?cat=other` still resolves for anyone holding
 * the link.
 */
const HIDDEN_BEATS = new Set(["other"]);

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="label mb-3 text-[11px] text-muted">
      {children}
    </h2>
  );
}

async function LeftRail({ teamSlug }: { teamSlug?: string }) {
  const [beats, teams, stats] = await Promise.all([
    beatCounts(),
    // 5 across, 4 down.
    activeTeams(20),
    wireStats(),
  ]);

  return (
    <aside className="sticky top-4 hidden py-6 pr-5 lg:block">
      {/*
       * At the top of the rail, because it is the one thing here that answers a
       * question the reader arrived with rather than offering them a way in.
       * The rail is `hidden lg:block`, so the search is desktop-only by
       * placement rather than by a breakpoint of its own.
       */}
      <SearchBox />

      <RailHeading>Beats since 2026</RailHeading>
      <nav className="mb-7 flex flex-col gap-px">
        <Link
          href="/?tab=latest"
          className="flex items-center justify-between rounded-sm px-3 py-2 text-sm text-body hover:bg-surface hover:text-white"
        >
          Latest Updates
          <span className="font-mono text-[11px] text-muted">
            {stats?.rumorCount ?? 0}
          </span>
        </Link>
        {beats
          .filter((b) => !HIDDEN_BEATS.has(b.type))
          .map((b) => (
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

      {/*
       * Named "Most active teams" rather than "Most active", because the rail
       * carries a search that also returns players and reports — the heading
       * has to say which of the three these chips are.
       */}
      <RailHeading>Most active teams</RailHeading>
      {/*
       * A fixed 5-column grid rather than flex-wrap: every chip gets the same
       * cell, so the block squares off and spans the rail's full width.
       */}
      <div className="mb-7 grid grid-cols-5 gap-1.5">
        {teams.map((t) => (
          <Link
            key={t.slug}
            href={`/team/${t.slug}`}
            aria-pressed={teamSlug === t.slug}
            title={`${t.abbreviation} · ${t.n} update${t.n === 1 ? "" : "s"}`}
            className={`rounded-sm border py-1 text-center font-mono text-[11px] tracking-wide ${
              teamSlug === t.slug
                ? "border-link bg-link font-bold text-white"
                : "border-rule bg-surface text-body hover:border-link hover:text-white"
            }`}
          >
            {t.abbreviation}
          </Link>
        ))}
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
          <h3 className="label text-xs">
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
          <h3 className="label text-xs">Done deals</h3>
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
  teamShort,
  playerLabel,
  playerShort,
  teamSlug,
  pinHeader = true,
}: {
  children: React.ReactNode;
  teamLabel?: string;
  /** Nickname alone, shown in place of the full name on phones. */
  teamShort?: string;
  playerLabel?: string;
  /** Surname alone, shown in place of the full name on phones. */
  playerShort?: string;
  teamSlug?: string;
  /**
   * Whether the masthead pins to the top on mobile.
   *
   * Exactly one element per page is pinned, which is the whole reason this
   * works. The feed pins its filter bar and opts out here; every other page
   * has nothing else pinned, so the masthead takes the job and a reader deep
   * in an article still has the logo and the way home on screen.
   */
  pinHeader?: boolean;
}) {
  return (
    <>
      {/*
       * One pinned element per page, and it belongs to whichever page needs it.
       *
       * The feed pins its filter bar, so the masthead there scrolls away like
       * an ordinary header. Everywhere else nothing is pinned, so the masthead
       * takes the job — and because it is alone, it can afford to retract as
       * you read and return when you scroll up.
       *
       * That combination is what used to break. The masthead published its
       * height as a CSS variable and the filter bar stuck to it, so hiding one
       * moved the other: a masthead-sized hole when a route change reused the
       * component, a masthead lost on refresh partway down a page, a band of
       * background above "Back to the feed", and the filter bar snapping 110px
       * in a frame while the logo took 200ms to travel. Nothing reads this
       * element's height any more, which is what makes the behaviour safe
       * rather than the behaviour itself.
       */}
      {pinHeader ? (
        <RevealHeader>
          <SiteHeader
            teamLabel={teamLabel}
            teamShort={teamShort}
            playerLabel={playerLabel}
            playerShort={playerShort}
          />
        </RevealHeader>
      ) : (
        <SiteHeader
            teamLabel={teamLabel}
            teamShort={teamShort}
            playerLabel={playerLabel}
            playerShort={playerShort}
          />
      )}
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-start px-0 sm:px-5 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        <LeftRail teamSlug={teamSlug} />
        <main className="min-h-screen">{children}</main>
        <RightRail />
      </div>
    </>
  );
}
