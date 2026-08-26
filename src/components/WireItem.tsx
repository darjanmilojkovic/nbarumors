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

/**
 * "4m" and "3h" inside a day, "21 Aug" beyond it.
 *
 * Relative time is the right register for a wire — but it is computed on the
 * server and baked into the HTML, and pages are cached for five minutes, so
 * what a reader sees is only ever as fresh as the last regeneration. On a
 * quiet night the first visitor is served a stale page, and "2h" can be hours
 * out of date.
 *
 * That risk is worth taking for the first day, where recency is the whole
 * point. Past that it is not: "5d" is both less precise than a date and more
 * likely to be wrong, so the long tail switches to something that cannot go
 * stale at all.
 *
 * The date carries no time and no year for the current year — the exact minute
 * is not information a reader of a week-old rumour needs.
 */
function ago(d: Date, now = new Date()) {
  const mins = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;

  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    // Only worth showing once a post is from a different year to today's.
    ...(d.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
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
      ? [
          rumor.contractValue,
          rumor.contractYears ? `${rumor.contractYears}yr` : null,
        ]
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

  /*
   * "DAL → MIA", drawn only when the post names both ends of the move.
   *
   * The team code used to come from players.current_team_id — the roster
   * sync — which is a different fact than the one the post is reporting. On a
   * completed signing the roster lags the news, so it showed the team the
   * player just left; on an unresolved trade rumor the roster is right, so it
   * showed the team they are still on. One chip, two opposite meanings, and
   * nothing to tell the reader which. Movement now comes from the rumor's own
   * from/to roles, which are per-post and cannot go stale.
   *
   * A scoring average used to ride along here. It was the one number on the
   * card that had nothing to do with the news — a stat line answers "how good
   * is he", which is not the question a transfer story raises.
   */
  const movedFrom = rumor.teams.find((t) => t.role === "from");
  const movedTo = rumor.teams.find((t) => t.role === "to");
  const primaryContext =
    movedFrom && movedTo
      ? `${movedFrom.abbreviation} → ${movedTo.abbreviation}`
      : null;

  /*
   * The star tier — 37 players, from Jokic and Giannis down to Wembanyama,
   * Zion, Brunson, Sengun and Butler.
   *
   * Judged on the player the story is ABOUT, not the highest-rated name that
   * appears in it. Reading the maximum across everyone tagged meant a Peyton
   * Watson trade counted as marquee because Nikola Jokic was mentioned in
   * passing — the badge was describing the cast list rather than the subject.
   *
   * 90 rather than the ceiling: pinned to 100 it marked only the sixteen
   * players saturating the scale, so Ja Morant and Karl-Anthony Towns missed
   * by a point.
   */
  const primaryPlayer = ordered.find((p) => p.isPrimary) ?? ordered[0];
  const isMarquee = (primaryPlayer?.prominence ?? 0) >= 90;

  /*
   * Momentum around the player, not this report — how many posts in the last
   * seven days name them. The query returns 0 on posts older than that window,
   * so a month-old piece can no longer claim "13 reports this week".
   *
   * Six rather than twelve. Only 47 posts are published in a typical week, so
   * twelve was reachable by exactly one player and the badge had quietly become
   * a Klay Thompson badge. At six it also catches the second and third biggest
   * stories while staying rare enough to mean something.
   */
  const isHot = rumor.hotMentions >= 6;

  const hasMeta =
    Boolean(money) ||
    rumor.sourceCount > 1 ||
    rumor.outcome === "confirmed" ||
    rumor.outcome === "unrecorded" ||
    isHot ||
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
       * gutter is placed on row 2 — level with the headline, because the
       * faces belong to the story rather than to the byline.
       */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 sm:gap-x-4">
        {/*
         * Two arrangements of the same three things.
         *
         * On a phone the badges take a full row of their own, below the byline
         * and kicker. Beside the byline there was only ever room for one at a
         * time, so a post carrying both stacked them into a narrow column that
         * stood taller than the text it sat next to. Given the whole width they
         * sit side by side on one line instead.
         *
         * From sm up they return to the right of the byline, where the width
         * exists and a dedicated row would just be empty space.
         */}
        <div className="col-start-2 mb-2 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
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
            </div>

            <div className="font-mono text-[10px] tracking-widest text-muted uppercase">
              {CAT[rumor.type] ?? "Update"}
              {rumor.teams.length > 0 &&
                ` · ${rumor.teams.map((t) => t.abbreviation).join(" / ")}`}
            </div>
          </div>

          {/*
           * Grouped rather than left as loose flex children, which is what let
           * them wrap independently and land on separate lines at odd moments.
           */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end sm:gap-1.5">
            {isMarquee && (
              <span
                className="bg-marquee/10 text-marquee rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase sm:px-2 sm:tracking-widest"
                title="Involves one of the league's most prominent players"
              >
                ★ Marquee
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase sm:px-2 sm:tracking-widest ${state.cls}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              {state.label}
            </span>
          </div>
        </div>

        {/*
         * A trade names several players, so show each of them — stacked
         * vertically in the gutter, primary first. Uniform 56px tiles with an
         * even gap keep the column aligned regardless of how many there are,
         * and the cap at three stops a rumor roundup mentioning eight names
         * from turning into a wall of faces.
         */}
        <div className="col-start-1 row-start-2 flex shrink-0 flex-col gap-2">
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
                  <span className="font-semibold grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-rule bg-surface-2 text-sm text-body">
                    {initials(p.fullName)}
                  </span>
                )}
              </Link>
            ))
          ) : (
            <Link href={`/rumor/${rumor.slug}`}>
              <span className="font-semibold grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-rule bg-surface-2 text-sm text-body">
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

        <div className="col-start-2 row-start-2 min-w-0">
          {/*
           * Plain greedy wrapping — neither balance nor pretty.
           *
           * Both of those reflow the whole headline to tidy the last line, and
           * they buy that by leaving the earlier lines short. On "Rivals Keep
           * Watching Kyrie Irving's Dallas Situation" at a 560px column,
           * text-pretty broke before DALLAS and left 86px of line one empty,
           * purely to avoid SITUATION sitting alone. Greedy wrapping fills
           * each line to the edge, which is what a headline should do; the
           * occasional one-word last line is the cheaper price.
           */}
          <h2 className="display mb-2 text-xl text-white sm:text-[26px]">
            <Link href={`/rumor/${rumor.slug}`} className="hover:text-link">
              {rumor.headline}
            </Link>
          </h2>

          {/*
           * 15.5px on 28px — a 1.8 ratio, following the reference. It looks
           * unreasonably loose written down and is the main reason that page
           * reads as easily as it does at a glance.
           */}
          <p className="max-w-[62ch] text-[15.5px] leading-7 text-body">
            {rumor.body}
          </p>

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
              {isHot && (
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

          {/*
           * Plain <details>, so it works without JS.
           *
           * The count says "reports", not "corroboration". The chain holds one
           * row per article while the badge above counts distinct outlets, so
           * three separate Yahoo pieces made this read "Corroboration chain
           * (4)" directly beneath "2 outlets". Both numbers were right and the
           * labels made them look like a contradiction — corroboration means
           * independent confirmation, and three articles from one masthead are
           * not independent of each other. Naming both quantities settles it.
           */}
          {rumor.chain.length > 1 && (
            <details className="mt-3 group">
              <summary className="cursor-pointer font-mono text-[11px] tracking-wider text-link uppercase marker:content-[''] hover:text-link/80">
                + {rumor.chain.length} reports
                {rumor.sourceCount > 1 && ` from ${rumor.sourceCount} outlets`}
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
