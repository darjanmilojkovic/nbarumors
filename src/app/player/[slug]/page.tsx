import type { Metadata } from "next";
import Image from "next/image";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { WireItem } from "@/components/WireItem";
import { Pager } from "@/components/Pager";
import { WireShell } from "@/components/WireShell";
import { playerBySlug, playerRedirectFor, rumorsForPlayer } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 300;

/** Deduped so the metadata lookup is not a second round trip. */
const getPlayer = cache(playerBySlug);

/** Page 1 is the bare URL, so it never competes with itself in search. */
const pageHref = (slug: string, page: number) =>
  page > 1 ? `/player/${slug}?page=${page}` : `/player/${slug}`;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/player/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const player = await getPlayer(slug);
  if (!player) return {};

  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);

  const description = `${player.fullName} trade rumors, contract news and signing reports, gathered from around the league and updated through the day.`;

  /*
   * Page 2 holds posts page 1 does not, so it earns its own canonical and a
   * title that says where you are — pointing every page at the bare URL would
   * tell a crawler they are the same document and hide the rest.
   */
  return {
    title:
      page > 1 ? `${player.fullName} rumors — page ${page}` : `${player.fullName} rumors`,
    description,
    alternates: { canonical: pageHref(player.slug, page) },
    openGraph: {
      title: `${player.fullName} rumors`,
      description,
      url: `${SITE.url}${pageHref(player.slug, page)}`,
    },
  };
}

export default async function PlayerPage({
  params,
  searchParams,
}: PageProps<"/player/[slug]">) {
  const { slug } = await params;
  const player = await getPlayer(slug);
  if (!player) {
    /*
     * A slug we retired when two rows turned out to be the same person, rather
     * than a slug that never existed. /player/bobby-portis-jr and four others
     * were live pages until the merge deleted the duplicate row; sending them
     * to the survivor keeps whatever standing they had, where a 404 discards
     * it. Checked only on a miss, so the normal request never pays for it.
     */
    const target = await playerRedirectFor(slug);
    if (target) permanentRedirect(`/player/${target}`);
    notFound();
  }

  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const { rumors, total, pageCount } = await rumorsForPlayer(slug, page);

  // A page past the last one does not exist; it is not an empty page.
  if (page > pageCount) notFound();

  return (
    <WireShell
      playerLabel={player.fullName}
    >
      {/* Mirrors the team page lockup: mark first, then name and count. */}
      <div className="mb-6 flex items-center gap-4 px-4 pt-8 sm:px-0">
        {player.headshotUrl ? (
          <Image
            src={player.headshotUrl}
            alt={player.fullName}
            width={128}
            height={94}
            className="h-12 w-12 shrink-0 rounded-sm border border-rule bg-surface-2 object-cover object-top sm:h-16 sm:w-16"
            unoptimized
          />
        ) : (
          /* 213 of 582 rostered players have no NBA headshot; initials keep
             the lockup the same shape rather than collapsing it. */
          <span className="font-semibold grid h-12 w-12 shrink-0 place-items-center rounded-sm border border-rule bg-surface-2 text-base text-body sm:h-16 sm:w-16">
            {player.fullName
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
        )}
        <div>
          <h1 className="display text-2xl text-white sm:text-3xl">
            {player.fullName}
          </h1>
          <p className="text-xs text-muted">
            {/* The whole body of coverage, not the ten on this page. */}
            {total} update{total === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      {/* Same panel the feed uses, so the column is ruled on all four sides. */}
      <div className="border-x border-rule bg-surface">
        {total === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted">
            Nothing on this player yet.
          </p>
        ) : (
          <>
            {rumors.map((r) => <WireItem key={r.id} rumor={r} />)}
            <Pager
              page={page}
              pageCount={pageCount}
              total={total}
              noun="updates"
              hrefFor={(p) => pageHref(player.slug, p)}
            />
          </>
        )}
      </div>
    </WireShell>
  );
}
