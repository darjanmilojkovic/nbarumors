import type { Metadata } from "next";
import Image from "next/image";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { WireItem } from "@/components/WireItem";
import { Pager } from "@/components/Pager";
import { WireShell } from "@/components/WireShell";
import { surname } from "@/lib/names";
import { playerBySlug, playerRedirectFor, rumorsForPlayer } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 300;

/** Deduped so the metadata lookup is not a second round trip. */
const getPlayer = cache(playerBySlug);

/** Shared with generateMetadata, so the empty check is not a second query. */
const getPlayerRumors = cache(rumorsForPlayer);

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
   * A player we have never written about gets a page that says so, and it is
   * not worth indexing.
   *
   * 149 of the 674 player pages were in that state: the only unique content is
   * a name and "Nothing on this player yet", everything else being rails that
   * repeat site-wide. Submitting 149 near-identical thin pages is how a site
   * earns "crawled, currently not indexed" across the rest of its URLs.
   *
   * The page still works and /players still links it — this only stops it
   * being indexed, and the sitemap leaves it out on the same condition, so the
   * two cannot disagree. Both reverse themselves the moment a post lands.
   *
   * `follow` stays on: the rails and the roster links are worth crawling even
   * when the page itself has nothing to say.
   */
  const { total } = await getPlayerRumors(slug, 1);

  /*
   * Page 2 holds posts page 1 does not, so it earns its own canonical and a
   * title that says where you are — pointing every page at the bare URL would
   * tell a crawler they are the same document and hide the rest.
   */
  return {
    title:
      page > 1 ? `${player.fullName} rumors — page ${page}` : `${player.fullName} rumors`,
    description,
    ...(total === 0 ? { robots: { index: false, follow: true } } : {}),
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
  const { rumors, total, pageCount } = await getPlayerRumors(slug, page);

  // A page past the last one does not exist; it is not an empty page.
  if (page > pageCount) notFound();

  return (
    <WireShell
      playerLabel={player.fullName}
      playerShort={surname(player.fullName)}
    >
      {/*
       * Mirrors the team page lockup: mark first, then name and count.
       *
       * The lockup sits on its own panel, separated from the list below rather
       * than joined to it. The mark's plate is the page black, not a lighter
       * grey — a headshot is a cut-out with dark edges, so black behind it
       * matches what the image was cut against and reads as a window into the
       * panel instead of a sticker on top of it.
       */}
      <div className="mb-6 px-4 pt-8 sm:px-0">
        <div className="flex items-center gap-4 rounded-sm border border-rule bg-surface p-4">
          {player.headshotUrl ? (
            <Image
              src={player.headshotUrl}
              alt={player.fullName}
              width={128}
              height={94}
              className="h-14 w-14 shrink-0 rounded-sm border border-rule bg-ink object-cover object-top sm:h-[72px] sm:w-[72px]"
              unoptimized
            />
          ) : (
            /* 213 of 582 rostered players have no NBA headshot; initials keep
               the lockup the same shape rather than collapsing it, and take the
               same plate so the panel does not change height between them. */
            <span className="font-semibold grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-rule bg-ink text-base text-body sm:h-[72px] sm:w-[72px]">
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
      </div>
      {/*
       * border-t as well as border-x. On the feed this panel opens with the
       * sticky filter bar, which carries its own bottom rule, so the chrome
       * above is always divided from the first card. Here it opens straight
       * onto a card, and the lockup ran into the list on nothing but a change
       * of background.
       */}
      <div className="border border-rule bg-surface">
        {total === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted">
            Nothing on this player yet.
          </p>
        ) : (
          <>
            {rumors.map((r) => <WireItem key={r.id} rumor={r} preview />)}
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
