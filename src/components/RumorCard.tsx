import Image from "next/image";
import Link from "next/link";
import type { FeedRumor } from "@/lib/queries";

const TYPE_LABEL: Record<string, string> = {
  trade: "Trade Rumor",
  signing: "Signing",
  free_agency: "Free Agency",
  buyout: "Buyout",
  extension: "Extension",
  waiver: "Waiver",
  draft: "Draft",
  injury_impact: "Injury",
  other: "Update",
};

const STATUS_LABEL: Record<string, string> = {
  rumor: "Rumor",
  reported: "Reported",
  confirmed: "Confirmed",
  completed: "Done Deal",
  debunked: "Debunked",
};

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function RumorCard({ rumor }: { rumor: FeedRumor }) {
  /*
   * Prefer the official headshot: it is the same crop for every player, so
   * cards stay consistent and faces never get cut off. The Commons action
   * photo is the fallback for players with no NBA id yet.
   */
  const primary = rumor.players.find((p) => p.isPrimary) ?? rumor.players[0];
  const hero: { kind: "headshot" | "action"; url: string } | null =
    primary?.headshotUrl
      ? { kind: "headshot", url: primary.headshotUrl }
      : rumor.imageUrl
        ? { kind: "action", url: rumor.imageUrl }
        : null;

  // Colour the field from the acquiring team where we know it.
  const accent =
    rumor.teams.find((t) => t.role === "to")?.primaryColor ??
    rumor.teams[0]?.primaryColor ??
    "#e07a2f";

  return (
    <article className="mb-8 bg-surface sm:mb-10">
      {/* Header: logos + headline wrap together on narrow screens. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
        <div className="flex shrink-0 items-center -space-x-1.5">
          {rumor.teams.slice(0, 2).map((t) => (
            <Link key={t.slug} href={`/team/${t.slug}`} title={`${t.city} ${t.name}`}>
              <Image
                src={t.logoUrl}
                alt={`${t.city} ${t.name}`}
                width={44}
                height={44}
                className="h-8 w-8 object-contain sm:h-11 sm:w-11"
                unoptimized
              />
            </Link>
          ))}
        </div>

        <h2 className="display min-w-0 flex-1 text-lg leading-tight text-white sm:text-2xl">
          <Link href={`/rumor/${rumor.slug}`} className="hover:text-accent">
            {rumor.headline}
          </Link>
        </h2>

        <span className="shrink-0 rounded-sm border border-rule px-2 py-0.5 text-[10px] tracking-wide text-muted uppercase sm:text-xs">
          {STATUS_LABEL[rumor.status] ?? rumor.status}
        </span>
      </header>

      <div className="mx-4 border-t border-rule sm:mx-6" />

      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <p className="text-[15px] leading-relaxed font-semibold text-body sm:text-base">
          {rumor.body}
        </p>

        {hero && (
          <figure className="mt-4">
            {/* Same target as the headline — the whole image is the link. */}
            <Link href={`/rumor/${rumor.slug}`} className="block">
              {hero.kind === "headshot" ? (
                /*
                 * Official NBA cutout on the team's colour. Identical framing
                 * for every player, so nothing is cropped through a face the
                 * way a random action photo is.
                 */
                <div
                  className="relative flex h-52 items-end justify-center overflow-hidden rounded-sm sm:h-64"
                  style={{
                    background: `radial-gradient(circle at 50% 120%, ${accent}cc 0%, ${accent}55 45%, #14141400 75%), #141414`,
                  }}
                >
                  <Image
                    src={hero.url}
                    alt={rumor.players.find((p) => p.isPrimary)?.fullName ?? rumor.headline}
                    width={1040}
                    height={760}
                    className="h-full w-auto object-contain object-bottom transition-transform duration-300 hover:scale-[1.03]"
                    unoptimized
                  />
                </div>
              ) : (
                /* Action photo — anchor to the top so heads survive the crop. */
                <Image
                  src={hero.url}
                  alt={rumor.players[0]?.fullName ?? rumor.headline}
                  width={1200}
                  height={700}
                  className="max-h-[420px] w-full rounded-sm object-cover object-top transition-opacity hover:opacity-90"
                  unoptimized
                />
              )}
            </Link>
            {hero.kind === "action" && rumor.imageAttribution && (
              <figcaption className="mt-1 text-[10px] text-muted">
                Photo: {rumor.imageAttribution}
              </figcaption>
            )}
          </figure>
        )}

        {rumor.players.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {rumor.players.map((p) => (
              <Link
                key={p.slug}
                href={`/player/${p.slug}`}
                className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted hover:text-accent"
              >
                {p.fullName}
              </Link>
            ))}
          </div>
        )}

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted sm:text-xs">
          <span>
            {TYPE_LABEL[rumor.type] ?? "Update"} @ {formatDate(rumor.publishedAt)}
          </span>
          <a
            href={rumor.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="hover:text-accent"
          >
            {/* "ESPN, ESPN" reads badly when the reporter is just the outlet. */}
            {rumor.reportedBy && rumor.reportedBy !== rumor.sourceName
              ? `${rumor.reportedBy}, `
              : ""}
            {rumor.sourceName} ↗
          </a>
        </footer>
      </div>
    </article>
  );
}
