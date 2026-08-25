import Image from "next/image";
import Link from "next/link";
import type { FeedRumor } from "@/lib/queries";

const CAT: Record<string, string> = {
  trade: "Trade",
  signing: "Signing",
  free_agency: "Free agency",
  buyout: "Buyout",
  extension: "Extension",
  waiver: "Waiver",
  draft: "Draft",
  injury_impact: "Injury",
  other: "Update",
};

/**
 * The five report states collapse to three visual states — what a reader
 * actually needs to know is "is this real yet".
 */
const STATE: Record<string, { label: string; cls: string }> = {
  /*
   * Five stored states, three shown. "Rumor" and "reported" were separate
   * chips in the same orange, which reads as an inconsistency rather than a
   * distinction — and the difference between them already does real work in
   * the source-strength meter, where reported floors at 2 bars and rumor at
   * 1. Same for confirmed and completed, both green and both meaning done.
   */
  rumor: { label: "Developing", cls: "text-accent bg-accent/10" },
  reported: { label: "Developing", cls: "text-accent bg-accent/10" },
  confirmed: { label: "Done deal", cls: "text-confirmed bg-confirmed/10" },
  completed: { label: "Done deal", cls: "text-confirmed bg-confirmed/10" },
  debunked: { label: "Debunked", cls: "text-debunked bg-debunked/10" },
};

/** "4m", "3h", "2d" — wire cadence, not a formatted date. */
function ago(d: Date) {
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function WireItem({ rumor }: { rumor: FeedRumor }) {
  const state = STATE[rumor.status] ?? STATE.rumor;

  // Primary player leads, then anyone we have a photo for, then the rest.
  const ordered = [...rumor.players].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      Number(Boolean(b.headshotUrl)) - Number(Boolean(a.headshotUrl)),
  );
  const MAX_FACES = 3;
  const faces = ordered.slice(0, MAX_FACES);
  const extraFaces = Math.max(0, ordered.length - MAX_FACES);

  /*
   * Some rumors name no player at all — "Kings and Raptors talks collapsed" —
   * and some name only players we have no photo for. Rather than a column of
   * initials or a generic mark, fall back to the team logos, which identify
   * the story just as well.
   */
  const hasAnyPhoto = ordered.some((p) => p.headshotUrl);
  const logoTiles = !hasAnyPhoto ? rumor.teams.slice(0, MAX_FACES) : [];

  const hasNamedReporter =
    Boolean(rumor.reportedBy) && rumor.reportedBy !== rumor.sourceName;

  const money =
    rumor.contractValue || rumor.contractYears
      ? [rumor.contractValue, rumor.contractYears ? `${rumor.contractYears}yr` : null]
          .filter(Boolean)
          .join(" · ")
      : null;

  const confirmedAfter =
    rumor.outcome === "confirmed" && rumor.outcomeAt
      ? Math.round(
          (new Date(rumor.outcomeAt).getTime() - rumor.publishedAt.getTime()) /
            864e5,
        )
      : null;

  const primary = ordered.find((p) => p.isPrimary) ?? ordered[0];

  /*
   * "DAL → MIA · 14 ppg".
   *
   * The team code used to come from players.current_team_id — the roster
   * sync — which is a different fact than the one the post is reporting. On a
   * completed signing the roster lags the news, so it showed the team the
   * player just left; on an unresolved trade rumor the roster is right, so it
   * showed the team they are still on. One chip, two opposite meanings, and
   * nothing to tell the reader which. Movement now comes from the rumor's own
   * from/to roles, which are per-post and cannot go stale, and it is only
   * drawn when the post actually names both ends.
   */
  const movedFrom = rumor.teams.find((t) => t.role === "from");
  const movedTo = rumor.teams.find((t) => t.role === "to");
  const move =
    movedFrom && movedTo
      ? `${movedFrom.abbreviation} → ${movedTo.abbreviation}`
      : null;
  const primaryContext =
    [move, primary?.pointsPerGame ? `${primary.pointsPerGame} ppg` : null]
      .filter(Boolean)
      .join(" · ") || null;

  /*
   * Rare by design. At >=80 the badge landed on 30% of page one, which is
   * no signal at all; >=88 puts it on ~13% of the front page and 5% of the
   * site, so it means something when it appears.
   */
  const isMarquee = rumor.maxProminence >= 88;

  const hasMeta =
    Boolean(money) ||
    rumor.sourceCount > 1 ||
    rumor.outcome === "confirmed" ||
    rumor.outcome === "unrecorded" ||
    rumor.hotMentions >= 12 ||
    Boolean(primaryContext);

  /*
   * py-7 (28px) rather than 20px: body copy sets ~22px between lines, so
   * tighter padding made the gap between two posts read as smaller than the
   * gap between two lines within one.
   */
  return (
    <article className="border-b border-rule px-4 py-7 transition-colors hover:bg-surface-2 sm:px-5">
      {/*
       * Explicit grid rather than a flex row. Byline and kicker sit in the
       * text column so they line up with the headline, while the portrait
       * gutter is placed on row 3 — level with the headline, because the
       * faces belong to the story rather than to the byline.
       */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 sm:gap-x-4">
        <div className="col-start-2 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {/*
           * The outlet name is the way back to the original article. Every
           * summary here is our words about someone else's reporting, so the
           * link out has to be somewhere obvious rather than absent.
           */}
          {hasNamedReporter ? (
            /*
             * When a reporter is credited, the byline is theirs and the link
             * hangs off their name — that is whose work it is. The outlet
             * stays as plain context beside it.
             */
            <>
              <a
                href={rumor.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={`Read ${rumor.reportedBy}'s report at ${rumor.sourceName}`}
                className="text-sm font-semibold hover:text-link"
              >
                {rumor.reportedBy} ↗
              </a>
              <span className="font-mono text-[11px] text-muted">
                · {rumor.sourceName}
              </span>
            </>
          ) : (
            <a
              href={rumor.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={`Read the original at ${rumor.sourceName}`}
              className="text-sm font-semibold hover:text-link"
            >
              {rumor.sourceName} ↗
            </a>
          )}
          <span className="font-mono text-[11px] text-muted">
            · {ago(rumor.publishedAt)}
          </span>
          {isMarquee && (
            <span
              className="ml-auto rounded-sm bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-accent uppercase"
              title="Involves one of the league's most prominent players"
            >
              ★ Marquee
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase ${isMarquee ? "" : "ml-auto"} ${state.cls}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {state.label}
          </span>
        </div>

        <div className="col-start-2 mb-2 font-mono text-[10px] tracking-widest text-muted uppercase">
          {CAT[rumor.type] ?? "Update"}
          {rumor.teams.length > 0 &&
            ` · ${rumor.teams.map((t) => t.abbreviation).join(" / ")}`}
        </div>

        {/*
         * A trade names several players, so show each of them — stacked
         * vertically in the gutter, primary first. Uniform 56px tiles with an
         * even gap keep the column aligned regardless of how many there are,
         * and the cap at three stops a rumor roundup mentioning eight names
         * from turning into a wall of faces.
         */}
        <div className="col-start-1 row-start-3 flex shrink-0 flex-col gap-2">
          {logoTiles.length > 0 ? (
            logoTiles.map((t) => (
              <Link
                key={t.slug}
                href={`/team/${t.slug}`}
                title={`${t.city} ${t.name}`}
                className="grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-rule bg-surface-2"
              >
                <Image
                  src={t.logoUrl}
                  alt={`${t.city} ${t.name}`}
                  width={56}
                  height={56}
                  className="h-9 w-9 object-contain"
                  unoptimized
                />
              </Link>
            ))
          ) : faces.length > 0 ? (
            faces.map((p) => (
              <Link key={p.slug} href={`/player/${p.slug}`} title={p.fullName}>
                {p.headshotUrl ? (
                  <Image
                    src={p.headshotUrl}
                    alt={p.fullName}
                    width={128}
                    height={94}
                    className="h-14 w-14 shrink-0 rounded-sm border border-rule bg-surface-2 object-cover object-top"
                    unoptimized
                  />
                ) : (
                  <span className="display grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-rule bg-surface-2 text-sm text-body">
                    {initials(p.fullName)}
                  </span>
                )}
              </Link>
            ))
          ) : (
            <Link href={`/rumor/${rumor.slug}`}>
              <span className="display grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-rule bg-surface-2 text-sm text-body">
                NBA
              </span>
            </Link>
          )}
          {extraFaces > 0 && (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-rule bg-surface-2 font-mono text-[11px] text-muted">
              +{extraFaces}
            </span>
          )}
        </div>

        <div className="col-start-2 row-start-3 min-w-0">
          {/*
           * text-pretty, not text-balance. Balance evens the length of every
           * line, which on a two-line headline splits it down the middle and
           * leaves the column looking half-used. Pretty fills each line and
           * only guards against a single-word last line.
           */}
          <h2 className="display mb-1.5 text-lg leading-tight text-pretty text-white sm:text-[22px]">
            <Link href={`/rumor/${rumor.slug}`} className="hover:text-link">
              {rumor.headline}
            </Link>
          </h2>

          <p className="max-w-[62ch] text-sm text-body">{rumor.body}</p>

          {/*
           * One meta strip, and every chip in it is conditional — a post that
           * has earned none of them shows none, and the strip itself does not
           * render, so it costs no vertical space.
           */}
          {hasMeta && (
          <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            {money && (
              <span className="rounded-sm border border-rule bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-bold text-body">
                {money}
              </span>
            )}

            {/*
             * Corroboration is shown only when it exists. 13 posts of ~500
             * carry more than one outlet, so "single outlet" appeared on 97%
             * of the site — a label that never varies is wallpaper, not
             * information. Absence now reads as an ordinary single-source
             * report, and the badge means something when it appears.
             */}
            {rumor.sourceCount > 1 && (
              <span
                className="rounded-sm border border-rule bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-body uppercase"
                title={`Independently reported by ${rumor.alsoReportedBy}`}
              >
                {rumor.sourceCount} outlets
              </span>
            )}

            {/* Checked against the official transaction log, not modelled. */}
            {rumor.outcome === "confirmed" && (
              <span
                className="rounded-sm bg-confirmed/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-confirmed uppercase"
                title="A matching move appears in the official transaction log"
              >
                ✓ Confirmed
                {confirmedAfter !== null && confirmedAfter > 0
                  ? ` ${confirmedAfter}d later`
                  : ""}
              </span>
            )}
            {rumor.outcome === "unrecorded" && (
              <span
                className="font-mono text-[10px] tracking-widest text-muted uppercase"
                title="Nothing matching this has appeared in the transaction log yet. Our log covers one season and excludes waivers and two-way deals, so this is not proof it did not happen."
              >
                No transaction on record
              </span>
            )}

            {/* Momentum around the player, independent of this one report. */}
            {rumor.hotMentions >= 12 && (
              <span className="font-mono text-[10px] tracking-widest text-accent uppercase">
                ▲ {rumor.hotMentions} reports this week
              </span>
            )}

            {primaryContext && (
              <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
                {primaryContext}
              </span>
            )}
          </div>
          )}

          {/* corroboration chain — plain <details>, so it works without JS */}
          {rumor.chain.length > 1 && (
            <details className="mt-3 group">
              <summary className="cursor-pointer font-mono text-[11px] tracking-wider text-link uppercase marker:content-[''] hover:text-link/80">
                + Corroboration chain ({rumor.chain.length})
              </summary>
              <div className="mt-2 flex flex-col gap-2 border-l-2 border-rule pl-3">
                {rumor.chain.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[11px] whitespace-nowrap text-muted">
                      {c.outlet} · {ago(new Date(c.at))}
                    </span>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-[13px] text-body hover:text-link"
                    >
                      {c.headline}
                    </a>
                  </div>
                ))}
              </div>
            </details>
          )}

          {rumor.players.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {rumor.players.map((p) => (
                <Link
                  key={p.slug}
                  href={`/player/${p.slug}`}
                  className="rounded-full bg-surface-2 px-2.5 py-0.5 font-mono text-[11px] text-muted hover:text-link"
                >
                  {p.fullName}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
