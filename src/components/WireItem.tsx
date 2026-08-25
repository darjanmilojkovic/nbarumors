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
  rumor: { label: "Developing", cls: "text-developing bg-[#F0F5FC]" },
  reported: { label: "Reported", cls: "text-developing bg-[#F0F5FC]" },
  confirmed: { label: "Confirmed", cls: "text-confirmed bg-[#EDF7F2]" },
  completed: { label: "Done deal", cls: "text-confirmed bg-[#EDF7F2]" },
  debunked: { label: "Debunked", cls: "text-debunked bg-[#FCF0EF]" },
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
   * Credibility bars are the model's confidence, raised by each independent
   * outlet that corroborated — not an invented score.
   */
  const bars = Math.max(1, Math.min(5, Math.round(rumor.confidence * 5)));

  return (
    <article className="border-t border-line py-6 first:border-t-0">
      {/* byline */}
      <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="text-[14px] font-semibold">
          {rumor.reportedBy && rumor.reportedBy !== rumor.sourceName
            ? rumor.reportedBy
            : rumor.sourceName}
        </span>
        <span className="font-mono text-[11px] text-muted">
          {rumor.reportedBy && rumor.reportedBy !== rumor.sourceName
            ? `${rumor.sourceName} · `
            : ""}
          {ago(rumor.publishedAt)}
        </span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-sm border border-current px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase ${state.cls}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {state.label}
        </span>
      </div>

      <div className="flex gap-4">
        {/*
         * Every player named in the rumor, stacked vertically. Uniform tiles
         * with an even gap keep the column aligned regardless of how many
         * there are; capped at three so a roundup naming eight doesn't turn
         * into a wall of faces.
         */}
        {faces.length > 0 && (
          <div className="hidden shrink-0 flex-col gap-2 sm:flex">
            {faces.map((p) => (
              <Link key={p.slug} href={`/player/${p.slug}`} title={p.fullName}>
                {p.headshotUrl ? (
                  <Image
                    src={p.headshotUrl}
                    alt={p.fullName}
                    width={128}
                    height={94}
                    className="h-14 w-14 shrink-0 rounded-sm border border-line bg-tint-2 object-cover object-top"
                    unoptimized
                  />
                ) : (
                  <span className="display grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-line bg-tint-2 text-sm text-ink-2">
                    {initials(p.fullName)}
                  </span>
                )}
              </Link>
            ))}
            {extraFaces > 0 && (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-line bg-tint-2 font-mono text-[11px] text-muted">
                +{extraFaces}
              </span>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
            {CAT[rumor.type] ?? "Update"}
            {rumor.teams.length > 0 &&
              ` · ${rumor.teams.map((t) => t.abbreviation).join(" / ")}`}
          </div>

          <h2 className="display mb-2.5 max-w-[30ch] text-[22px] leading-[1.15] text-balance sm:text-[29px]">
            <Link href={`/rumor/${rumor.slug}`} className="hover:text-accent">
              {rumor.headline}
            </Link>
          </h2>

          <p className="mb-4 max-w-[64ch] text-ink-2">{rumor.body}</p>

          {/* credibility */}
          <div className="mb-3.5 flex flex-wrap items-center gap-3">
            <span
              className="flex gap-[3px]"
              role="img"
              aria-label={`Credibility ${bars} of 5`}
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  className={`block h-[5px] w-[22px] rounded-[1px] border ${
                    i <= bars
                      ? bars >= 4
                        ? "border-accent bg-accent"
                        : "border-heat bg-heat"
                      : "border-line bg-tint-2"
                  }`}
                />
              ))}
            </span>
            <span className="font-mono text-[10.5px] tracking-[0.09em] text-muted uppercase">
              {rumor.sourceCount > 1
                ? `${rumor.sourceCount} outlets · corroborated`
                : "Single outlet"}
            </span>
          </div>

          {/* corroboration chain — plain <details>, so it works without JS */}
          {rumor.chain.length > 1 && (
            <details className="mb-3.5">
              <summary className="inline-block cursor-pointer border-b border-current font-mono text-[10.5px] tracking-[0.1em] text-accent uppercase marker:content-['']">
                Corroboration chain ({rumor.chain.length})
              </summary>
              <div className="mt-3 flex flex-col gap-2.5 rounded-sm border border-line bg-tint px-4 py-3.5">
                {rumor.chain.map((c, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-0.5 text-[13.5px] text-ink-2 sm:flex-row sm:items-baseline sm:gap-2.5"
                  >
                    <span className="font-mono text-[10.5px] whitespace-nowrap text-muted sm:min-w-[118px]">
                      {c.outlet} · {ago(new Date(c.at))}
                    </span>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="hover:text-accent"
                    >
                      {c.headline}
                    </a>
                  </div>
                ))}
              </div>
            </details>
          )}

          {rumor.players.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {rumor.players.map((p) => (
                <Link
                  key={p.slug}
                  href={`/player/${p.slug}`}
                  className="rounded-full border border-line-2 px-2.5 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent"
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
