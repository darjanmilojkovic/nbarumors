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
   * Unconfirmed states take the accent orange — the same orange as a filled
   * credibility bar, so "not nailed down yet" reads as one colour. Blue is
   * now reserved entirely for links and current-page state.
   */
  rumor: { label: "Developing", cls: "text-accent bg-accent/10" },
  reported: { label: "Reported", cls: "text-accent bg-accent/10" },
  confirmed: { label: "Confirmed", cls: "text-confirmed bg-confirmed/10" },
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

/**
 * Sourcing strength, 1-5.
 *
 * Deliberately NOT the model's `confidence`: that field answers "is this
 * genuinely a transfer story", which is a filtering question, not a
 * trustworthiness one — and since anything under 0.6 is held back, it could
 * never render below 3 bars anyway. This scores what a reader actually wants
 * beside "N outlets": how firm the report is and how many independent
 * newsrooms carry it.
 */
function sourcingScore(rumor: FeedRumor): number {
  // A denial is its own signal; the red chip carries it, so the meter stays low.
  if (rumor.status === "debunked") return 1;

  /*
   * Status sets the floor. A single outlet reporting a real signing is
   * ordinary, sound journalism and should not read as barely-sourced, so
   * "reported" starts at 2 and a done deal starts at 3.
   */
  let score =
    rumor.status === "confirmed" || rumor.status === "completed"
      ? 3
      : rumor.status === "reported"
        ? 2
        : 1;

  // Independent corroboration, worth at most two bars.
  score += Math.min(2, Math.max(0, rumor.sourceCount - 1));

  // A credited insider beats an unattributed aggregator post.
  if (rumor.reportedBy && rumor.reportedBy !== rumor.sourceName) score += 1;

  return Math.max(1, Math.min(5, score));
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

  const bars = sourcingScore(rumor);

  return (
    <article className="border-b border-rule px-4 py-5 transition-colors hover:bg-surface-2 sm:px-5">
      <div className="flex gap-3 sm:gap-4">
        {/*
         * A trade names several players, so show each of them — stacked
         * vertically in the gutter, primary first. Uniform 56px tiles with an
         * even gap keep the column aligned regardless of how many there are,
         * and the cap at three stops a rumor roundup mentioning eight names
         * from turning into a wall of faces.
         */}
        <div className="flex shrink-0 flex-col gap-2">
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

        <div className="min-w-0 flex-1">
          {/* byline row */}
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">
              {rumor.reportedBy && rumor.reportedBy !== rumor.sourceName
                ? rumor.reportedBy
                : rumor.sourceName}
            </span>
            <span className="font-mono text-[11px] text-muted">
              {rumor.reportedBy && rumor.reportedBy !== rumor.sourceName
                ? `· ${rumor.sourceName} `
                : ""}
              · {ago(rumor.publishedAt)}
            </span>
            <span
              className={`ml-auto inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase ${state.cls}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {state.label}
            </span>
          </div>

          <div className="font-mono text-[10px] tracking-widest text-muted uppercase">
            {CAT[rumor.type] ?? "Update"}
            {rumor.teams.length > 0 &&
              ` · ${rumor.teams.map((t) => t.abbreviation).join(" / ")}`}
          </div>

          <h2 className="display my-1.5 text-lg leading-tight text-balance text-white sm:text-[22px]">
            <Link href={`/rumor/${rumor.slug}`} className="hover:text-link">
              {rumor.headline}
            </Link>
          </h2>

          <p className="max-w-[62ch] text-sm text-body">{rumor.body}</p>

          {/* credibility */}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span
              className="flex gap-[3px]"
              role="img"
              aria-label={`Source strength ${bars} of 5`}
              title="Source strength: how firm the report is, how many independent outlets carry it, and whether a reporter is credited."
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  className={`block h-1 w-5 rounded-[1px] ${
                    i <= bars ? (bars >= 4 ? "bg-accent" : "bg-heat") : "bg-rule"
                  }`}
                />
              ))}
            </span>
            <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
              Source strength {bars}/5 ·{" "}
              {rumor.sourceCount > 1
                ? `${rumor.sourceCount} outlets`
                : "single outlet"}
            </span>
          </div>

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
