import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import {
  activeTeams,
  mostMentioned,
  recentlyDone,
  wireStats,
} from "@/lib/queries";

function Card({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 overflow-hidden rounded-sm border border-line bg-tint">
      <div className="flex items-baseline justify-between gap-2 border-b border-line bg-ground px-3.5 py-3">
        <h3 className="display text-[11.5px] font-bold tracking-[0.13em]">{title}</h3>
        {meta && <span className="font-mono text-[10px] text-muted">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * The single rail. Everything here is real: the concept's Insider Board and
 * Cap Sheet Watch needed hit-rate and salary-cap data we do not have, so they
 * are replaced rather than filled with invented numbers.
 */
async function Rail({ teamSlug }: { teamSlug?: string }) {
  const [players, done, teams, stats] = await Promise.all([
    mostMentioned(),
    recentlyDone(6),
    activeTeams(14),
    wireStats(),
  ]);

  return (
    <aside className="border-t border-line pt-7 lg:sticky lg:top-5 lg:border-t-0 lg:pt-8">
      {/* Counters, in place of the concept's invented cap sheet. */}
      <div className="mb-5 rounded-sm border border-ink bg-ground p-4">
        <div className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
          In the mill
        </div>
        <div className="display my-2 text-[40px] leading-none tabular-nums">
          {stats?.rumorCount ?? 0}
          <i className="text-accent not-italic">·</i>
        </div>
        <div className="text-[12.5px] text-muted">
          {stats?.corroborated ?? 0} corroborated by two or more outlets
          <br />
          {stats?.playerCount ?? 0} players · {stats?.outletCount ?? 0} outlets
          monitored
        </div>
      </div>

      <Card title="Most mentioned" meta="7d">
        {players.length === 0 ? (
          <p className="px-3.5 py-4 text-[13px] text-muted">Nothing this week.</p>
        ) : (
          players.map((p, i) => (
            <Link
              key={p.slug}
              href={`/player/${p.slug}`}
              className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5 border-b border-line px-3.5 py-2.5 last:border-b-0 hover:bg-ground"
            >
              <span className="font-mono text-[10.5px] text-muted tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {p.headshotUrl && (
                  <Image
                    src={p.headshotUrl}
                    alt=""
                    width={64}
                    height={47}
                    className="h-7 w-7 shrink-0 rounded-full bg-tint-2 object-cover object-top"
                    unoptimized
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] leading-tight font-semibold">
                    {p.fullName}
                  </span>
                  <span className="block font-mono text-[10.5px] text-muted">
                    {p.mentions} report{p.mentions === 1 ? "" : "s"}
                  </span>
                </span>
              </span>
            </Link>
          ))
        )}
      </Card>

      <Card title="Done deals" meta="Latest">
        {done.map((d) => (
          <Link
            key={d.slug}
            href={`/rumor/${d.slug}`}
            className="block border-b border-line px-3.5 py-2.5 text-[13.5px] leading-snug last:border-b-0 hover:bg-ground"
          >
            {d.headline}
          </Link>
        ))}
      </Card>

      <Card title="Most active" meta="Teams">
        <div className="flex flex-wrap gap-1.5 p-3.5">
          {teams.map((t) => (
            <Link
              key={t.slug}
              href={`/team/${t.slug}`}
              className={`rounded-sm border px-2 py-1 font-mono text-[11px] tracking-wider ${
                teamSlug === t.slug
                  ? "border-accent bg-accent font-bold text-white"
                  : "border-line-2 bg-ground text-ink-2 hover:border-accent hover:text-accent"
              }`}
            >
              {t.abbreviation}
            </Link>
          ))}
        </div>
      </Card>

      <p className="font-mono text-[10px] leading-[1.8] tracking-[0.02em] text-muted">
        Every item is summarized in our own words from public reporting and links
        back to its source.
      </p>
    </aside>
  );
}

/** Content column plus one rail — the paper edition's two-column shell. */
export function WireShell({
  children,
  teamLabel,
  teamHref,
  playerLabel,
  playerHref,
  teamSlug,
  activeBeat,
}: {
  children: React.ReactNode;
  teamLabel?: string;
  teamHref?: string;
  playerLabel?: string;
  playerHref?: string;
  teamSlug?: string;
  activeBeat?: string;
}) {
  return (
    <>
      <SiteHeader
        teamLabel={teamLabel}
        teamHref={teamHref}
        playerLabel={playerLabel}
        playerHref={playerHref}
        activeBeat={activeBeat}
      />
      <div className="mx-auto grid max-w-[1160px] grid-cols-1 items-start gap-0 px-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-11">
        <main className="min-h-screen pb-10">{children}</main>
        <Rail teamSlug={teamSlug} />
      </div>
    </>
  );
}
