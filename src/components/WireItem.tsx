import Image from "next/image";
import Link from "next/link";
import { Quoted } from "@/components/Quoted";
import { toParagraphs } from "@/lib/paragraphs";
import type { FeedRumor } from "@/lib/queries";

/*
 * The kicker names what KIND of story this is, so the two commonest types say
 * so in full: "Trade" alone reads as a completed trade on a post that is only
 * floating one, and "Signing" is the event where the kicker could just as
 * easily be naming the contract.
 */
const CAT: Record<string, string> = {
  trade: "Trade rumor",
  signing: "Contract signing",
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
 * The date carries no time of day: the exact minute is not something a reader
 * of a week-old rumour needs, and omitting it avoids picking a timezone that
 * is right for neither the league nor the reader.
 */
/** Past this the stamp is a calendar date rather than an elapsed time. */
const RELATIVE_LIMIT_MINS = 1440;

const minutesSince = (d: Date, now: Date) =>
  Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));

function ago(d: Date, now = new Date()) {
  const mins = minutesSince(d, now);
  if (mins < 60) return `${mins}m`;
  if (mins < RELATIVE_LIMIT_MINS) return `${Math.round(mins / 60)}h`;

  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The same stamp as a phrase: "14h ago", but "26 Aug 2026" unchanged.
 *
 * Only the relative form takes "ago". Appending it unconditionally reads as
 * "updated 26 Aug 2026 ago" on anything older than a day, which is most of the
 * archive — the threshold is shared with `ago` rather than restated so the two
 * cannot disagree about where the switch happens.
 */
function agoPhrase(d: Date, now = new Date()) {
  const stamp = ago(d, now);
  return minutesSince(d, now) < RELATIVE_LIMIT_MINS ? `${stamp} ago` : stamp;
}

/** Generational suffixes, which are part of the surname rather than after it. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * @param preview  Show the opening paragraph and link to the rest.
 *
 * A card in a list and the post you opened are the same component doing two
 * jobs. In a list the card is an offer — enough to decide whether to read it —
 * and forty full summaries stacked up is a page you scroll past rather than
 * choose from. On its own page the post is the thing you came for and shows
 * everything.
 */
export function WireItem({
  rumor,
  preview = false,
}: {
  rumor: FeedRumor;
  preview?: boolean;
}) {
  const state = STATE[rumor.status] ?? STATE.rumor;

  const paragraphs = toParagraphs(rumor.body);
  const shownParas = preview ? paragraphs.slice(0, 1) : paragraphs;
  const truncated = preview && paragraphs.length > shownParas.length;

  // Primary player leads, then anyone we have a photo for, then the rest.
  const ordered = [...rumor.players].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      Number(Boolean(b.headshotUrl)) - Number(Boolean(a.headshotUrl)),
  );
  const MAX_FACES = 3;

  /*
   * Only the people the story is about get a face.
   *
   * Every name in a report is tagged, which is right for finding coverage but
   * wrong for a portrait. Klay Thompson's buyout described the Dallas roster he
   * was leaving, so Luka Doncic, Kyrie Irving and Anthony Davis were tagged —
   * and the card showed their photos beside his on a post about one player
   * signing for Miami, as though all four were moving.
   *
   * A player qualifies by being the subject or by actually moving in the deal,
   * which keeps both sides of a trade — Butler and Kuminga in a three-team
   * proposal are one primary and one not, and both belong on the card.
   */
  const inTheStory = ordered.filter(
    (p) => p.isPrimary || (p.fromAbbrev && p.toAbbrev),
  );
  const cast = inTheStory.length > 0 ? inTheStory : ordered;
  /*
   * A "+1" tile occupies exactly the room of the face it is hiding, so at four
   * players it trades a portrait for a count and tells the reader nothing. The
   * overflow tile only earns its place when it stands for two or more.
   */
  const shown = cast.length === MAX_FACES + 1 ? MAX_FACES + 1 : MAX_FACES;
  const faces = cast.slice(0, shown);
  const extraFaces = Math.max(0, cast.length - shown);

  /*
   * Some rumors name no player at all — "Kings and Raptors talks collapsed" —
   * and some name only players we have no photo for. Rather than a column of
   * initials or a generic mark, fall back to the team logos, which identify
   * the story just as well.
   */
  const hasAnyPhoto = cast.some((p) => p.headshotUrl);
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
   * Only worth showing when the gap is real. A summary rewritten minutes after
   * publication, which is what happens when two outlets file within one ingest
   * cycle, is the post being assembled rather than updated.
   */
  const updated =
    rumor.bodyUpdatedAt &&
    rumor.bodyUpdatedAt.getTime() - rumor.publishedAt.getTime() > 30 * 60_000
      ? rumor.bodyUpdatedAt
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

  /*
   * One arrow per player, when the post moves more than one.
   *
   * A three-team proposal sending Jimmy Butler to Atlanta and Jonathan Kuminga
   * to Milwaukee has one "from" and two "to" rows against the post, so a
   * single arrow could only ever name one destination, and which one came down
   * to the order Postgres returned. Each player now carries their own
   * direction.
   *
   * Ordered by prominence, so the arrow a reader looks for first is the one
   * for the biggest name in the deal: Butler at 90 leads Kuminga at 58.
   */
  const moves = rumor.players
    .filter((p) => p.fromAbbrev && p.toAbbrev)
    .sort((a, b) => b.prominence - a.prominence)
    .slice(0, 3);

  /*
   * Every movement the post describes, one string per chip.
   *
   * Where players carry their own from/to, each gets a chip naming him. Where
   * only the post does — 40 of 200 feed posts — there is one arrow and no
   * player attached to it, so the subject supplies the name instead: "Kings
   * stretch DeRozan's remaining $10M salary" is tagged SAC → DEN and is
   * plainly about DeRozan.
   *
   * That fallback is refused when the post has more than one subject. "Klay
   * Thompson to Miami, DeRozan to Denver" carries a single DAL → MIA pair and
   * two primaries, so a surname there would pin the arrow on whichever name
   * sorted first and state something the post does not. Two of 200 land in
   * that case, and they keep the bare team arrow.
   */
  /**
   * The last name, carrying its suffix.
   *
   * Taking the final word alone turned 68 players into "Jr." or "III" —
   * "Jr. MIL → MIA" for Kevin Porter Jr., and the same for Jaren Jackson Jr.,
   * Michael Porter Jr. and Trey Murphy III. The suffix stays attached because
   * it is part of how these players are named, and because dropping it would
   * collapse Michael Porter Jr. and Kevin Porter onto one label.
   */
  const surname = (name: string) => {
    const parts = name.trim().split(/\s+/);
    const tail = parts[parts.length - 1];
    return parts.length > 2 && SUFFIXES.has(tail.toLowerCase().replace(/\.$/, ""))
      ? `${parts[parts.length - 2]} ${tail}`
      : tail;
  };

  const movements: string[] =
    moves.length > 0
      ? moves.map((p) => `${surname(p.fullName)} ${p.fromAbbrev} → ${p.toAbbrev}`)
      : movedFrom && movedTo
        ? [
            (() => {
              const primaries = rumor.players.filter((p) => p.isPrimary);
              const arrow = `${movedFrom.abbreviation} → ${movedTo.abbreviation}`;
              return primaries.length === 1
                ? `${surname(primaries[0].fullName)} ${arrow}`
                : arrow;
            })(),
          ]
        : [];

  /*
   * Whose contract this is, when the card can say so without repeating itself.
   *
   * On a multi-player deal the terms were unattributed: "[Duren DET → CHA]
   * [Turner MIL → DET] [Johnson DEN → DET] [$160M · 4yr]" gives no way to tell
   * which of the three the money belongs to. Naming the subject settles it.
   *
   * Two refusals. A post with more than one subject cannot say whose contract
   * it is — the same guard the movement chips use. And where a single movement
   * chip already names him, the name is dropped rather than printed twice:
   * "[Kuminga GSW → MIN] [Kuminga $13M · 2yr]" stutters, while the same
   * addition beside three movement chips is the thing that makes them legible.
   */
  const moneySubject = (() => {
    if (!money) return null;
    const primaries = rumor.players.filter((p) => p.isPrimary);
    if (primaries.length !== 1) return null;
    const name = surname(primaries[0].fullName);
    if (movements.length === 1 && movements[0].startsWith(`${name} `)) return null;
    return name;
  })();

  /*
   * The kicker names the teams in the move, not every team the report happens
   * to mention. A Josh Hart extension listed "BOS / NYK / PHX" because the
   * piece cites Derrick White and Dillon Brooks as comparables, which reads as
   * a three-team story rather than one Knick's contract.
   *
   * Posts with nothing but mentioned teams — "both the Lakers and the Heat are
   * interested" — still show them, because there the interest IS the news.
   */
  const involved = rumor.teams.filter((t) => t.role !== "mentioned");
  const kickerTeams = (involved.length > 0 ? involved : rumor.teams).slice(0, 3);

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

  /*
   * sourceCount is deliberately absent: it no longer renders a chip here, so
   * counting it would open an empty strip on a post whose only distinction is
   * that two outlets filed it.
   */
  const hasMeta =
    Boolean(money) ||
    rumor.outcome === "confirmed" ||
    rumor.outcome === "unrecorded" ||
    isHot ||
    movements.length > 0;

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
              {/*
               * The outlet, always — never the reporter's name.
               *
               * Crediting the byline where we had one and the outlet where we
               * did not meant the same slot said different kinds of thing on
               * different cards: "Jake Fischer ↗ · Bleacher Report" on one and
               * "Yahoo Sports ↗" on the next, on 83 of 651 posts. A reader
               * scanning the feed cannot tell whether the bold name is a person
               * or a publication, which makes it useless as a signal of where
               * the story came from.
               *
               * The reporter is not lost: 73 of those 83 bodies already name
               * them in the prose, which is where the credit reads as a
               * sentence rather than as a label.
               */}
              <a
                href={rumor.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={
                  hasNamedReporter
                    ? `Read ${rumor.reportedBy}'s report at ${rumor.sourceName}`
                    : `Read the original at ${rumor.sourceName}`
                }
                className="text-sm font-semibold hover:text-link"
              >
                {rumor.sourceName} ↗
              </a>
              <span className="font-mono text-[11px] text-muted">
                · {ago(rumor.publishedAt)}
              </span>
              {/*
               * A post that has taken in a later report says so. The date
               * beside the byline stays pinned to the first report, because
               * that is when the story broke and what the feed orders on — but
               * a reader looking at a three-day-old rumour deserves to know
               * the summary is not three days old.
               */}
              {updated && (
                <span className="font-mono text-[11px] text-muted">
                  {/*
                   * The separator stays muted with the rest of the meta row and
                   * only the phrase takes colour — a coloured dot reads as part
                   * of the punctuation between chips rather than as part of
                   * this one.
                   */}
                  · <span className="text-confirmed">updated {agoPhrase(updated)}</span>
                </span>
              )}
            </div>

            <div className="font-mono text-[10px] tracking-widest text-muted uppercase">
              {CAT[rumor.type] ?? "Update"}
              {kickerTeams.length > 0 &&
                ` · ${kickerTeams.map((t) => t.abbreviation).join(" / ")}`}
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
                {t.logoUrl ? (
                  <Image
                    src={t.logoUrl}
                    alt={`${t.city} ${t.name}`}
                    width={56}
                    height={56}
                    className="h-9 w-9 object-contain"
                    unoptimized
                  />
                ) : (
                  <span className="display text-xs text-body">{t.abbreviation}</span>
                )}
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
          {/*
           * Paragraphs, once a summary is long enough to need them. They were
           * two sentences when this was one <p>; a post that has absorbed
           * later reports runs to five, which is a twelve-line block at this
           * measure with nowhere for the eye to rest.
           */}
          <div className="max-w-[62ch] space-y-3 text-[15.5px] leading-7 text-body">
            {shownParas.map((para, i) => (
              <p key={i}>
                <Quoted text={para} />
              </p>
            ))}
          </div>

          {/*
           * Only where there is genuinely more to read. 503 of 654 posts are a
           * single paragraph, so a "read more" on every card would be a promise
           * broken three times in four — and the headline above already leads
           * to the same place.
           *
           * Outside the prose block so it can own its spacing. mt-3 matches the
           * gap between paragraphs, which keeps it attached to the text it
           * continues, and nothing is set below — whatever follows brings its
           * own top margin, which is the card's ordinary rhythm.
           *
           * It carried mb-6 for a while, twice the gap above. That reads as
           * deliberate on a card ending in a bordered chip and as a hole on one
           * ending in loose text, and the strip below is now sometimes one and
           * sometimes the other.
           *
           * Styled as the same bordered control the pager uses. A coloured line
           * of text reads as one more link among the outlet, the headline and
           * the player chips; a button is the one thing on the card that looks
           * pressable.
           */}
          {truncated && (
            <div className="mt-3">
              <Link
                href={`/rumor/${rumor.slug}`}
                /*
                 * Outlined in the link blue at rest, filled on hover.
                 *
                 * Filling rather than tinting: `bg-link/10` behind blue text is
                 * already the site's language for a SELECTED category chip, and
                 * a hovered button that looks selected says the wrong thing.
                 *
                 * Dark text on the fill, not white. #5e9ad8 is light enough
                 * that white sits at 2.96:1 and fails AA outright, while the
                 * ink reads at 6.56:1 — the same reason a mid-tone blue button
                 * usually wants dark type.
                 */
                className="inline-block rounded-sm border border-link px-3 py-2 font-mono text-[11px] tracking-widest text-link uppercase transition-colors hover:bg-link hover:text-ink"
              >
                Read more →
              </Link>
            </div>
          )}

          {/*
           * One meta strip, and every chip in it is conditional — a post that
           * has earned none of them shows none, and the strip itself does not
           * render, so it costs no vertical space.
           */}
          {/*
           * Order here is fixed, not incidental. Four slots, always in this
           * sequence:
           *
           *   1. money chip      — the terms, when the post carries any
           *   2. movement        — who is going where, as one line
           *   3. outcome         — confirmed, or old enough to expect a record
           *   4. reports count   — how hard the story is being covered
           *
           * The chip leads because it is the only bordered object in the row,
           * and a row that starts with one and then runs into loose text reads
           * as deliberate where the reverse reads as a stray box. The count
           * trails because it is the only item describing the coverage rather
           * than the deal.
           *
           * Left to fall where they were written, the count landed between the
           * money and the movement on any hot post, so a card carried its facts
           * in a different order depending on how much had been written that
           * week.
           *
           * mt-3, matching the chain and the player chips below it. This was
           * the one block at 3.5, which put 14px under the read-more button
           * against the 12 above it.
           */}
          {hasMeta && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              {money && (
                <span className="rounded-sm border border-rule bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-bold text-body">
                  {moneySubject ? `${moneySubject} ${money}` : money}
                </span>
              )}

              {/*
               * Loose text, not chips.
               *
               * As chips these competed with the player links two rows below:
               * a three-player trade printed Herro, White and Scheierman in
               * bold bordered boxes and then again as plain names underneath,
               * 75 duplicated names across 200 cards. Chips gave the movement
               * more weight than the navigation it was repeating.
               *
               * One span with pipes between legs. As separate flex children the
               * gap alone had to carry the division, and "Butler GSW → ATL
               * Kuminga GSW → MIL" ran together as a single string. A pipe
               * rather than the byline row's middot: these legs each contain an
               * arrow already, and the heavier rule reads as a divider between
               * them rather than more punctuation inside one.
               *
               * Surname alone: the arrow is the point, and full names turn a
               * two-player deal into two lines of chrome.
               */}
              {movements.length > 0 && (
                <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
                  {movements.join("  |  ")}
                </span>
              )}

              {/*
               * No "N outlets" badge here any more. The corroboration chain
               * below already opens with "+ 5 reports from 4 outlets", so the
               * badge restated the same count a few pixels above it — and
               * unlike the chain it could not be opened to see whose reports
               * they were. Two labels for one fact, one of which led nowhere.
               */}

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
              <summary className="cursor-pointer font-mono text-[11px] tracking-wider text-corroborated uppercase marker:content-[''] hover:text-corroborated/80">
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
