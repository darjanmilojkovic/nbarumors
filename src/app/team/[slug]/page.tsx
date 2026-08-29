import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cache } from "react";
import { WireItem } from "@/components/WireItem";
import { Pager } from "@/components/Pager";
import { WireShell } from "@/components/WireShell";
import { rumorsForTeam, teamBySlug } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 300;

/** Deduped so the metadata lookup is not a second round trip. */
const getTeam = cache(teamBySlug);

/** Page 1 is the bare URL, so it never competes with itself in search. */
const pageHref = (slug: string, page: number) =>
  page > 1 ? `/team/${slug}?page=${page}` : `/team/${slug}`;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/team/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const team = await getTeam(slug);
  if (!team) return {};

  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);

  const name = `${team.city} ${team.name}`;
  const description = `${name} trade rumors, signings and roster moves, gathered from around the league and updated through the day.`;

  /*
   * Page 2 holds posts page 1 does not, so it earns its own canonical and a
   * title that says where you are — pointing every page at the bare URL would
   * tell a crawler they are the same document and hide the rest of the
   * coverage.
   */
  return {
    title: page > 1 ? `${name} rumors — page ${page}` : `${name} rumors`,
    description,
    alternates: { canonical: pageHref(team.slug, page) },
    openGraph: {
      title: `${name} rumors`,
      description,
      url: `${SITE.url}${pageHref(team.slug, page)}`,
      /*
       * The site mark, not the club's own logo, and that is a limitation
       * rather than a choice: the logos on disk are SVG, and Facebook, X,
       * Slack and LinkedIn all refuse to render an SVG og:image. Raster
       * versions of the thirty would give each club its own card.
       *
       * Declared explicitly because naming an openGraph block here replaces
       * the root one rather than merging with it — which is exactly how these
       * pages came to have no image at all.
       */
      images: [
        { url: "/android-chrome-512x512.png", width: 512, height: 512 },
      ],
    },
  };
}

export default async function TeamPage({
  params,
  searchParams,
}: PageProps<"/team/[slug]">) {
  const { slug } = await params;
  const team = await getTeam(slug);
  if (!team) notFound();

  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const { rumors, total, pageCount } = await rumorsForTeam(slug, page);

  // A page past the last one does not exist; it is not an empty page.
  if (page > pageCount) notFound();

  return (
    <WireShell
      teamLabel={`${team.city} ${team.name}`}
      teamShort={team.name}
      teamSlug={team.slug}
    >
      {/*
       * Breadcrumb data. Renders nothing here — it changes the URL line in a
       * search result from the bare address to a trail: nbarumors.cc > Teams >
       * Atlanta Hawks.
       */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Teams",
                item: `${SITE.url}/teams`,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: `${team.city} ${team.name}`,
                item: `${SITE.url}/team/${team.slug}`,
              },
            ],
          }),
        }}
      />

      {/*
       * Same lockup as the player page: the mark on the page black, inside a
       * panel of its own, separated from the list below.
       *
       * The logo gains a plate it never had — it was drawn straight onto the
       * page, so it floated while the player's headshot at least had a frame.
       * It is padded because a logo is a silhouette rather than a crop: without
       * the inset the mark touches its own border.
       */}
      <div className="mb-6 px-4 pt-8 sm:px-0">
        <div className="flex items-center gap-4 rounded-sm border border-rule bg-surface p-4">
          {/* Every mark is committed, so the fallback should never render — but
              the manifest decides what is on disk, and an abbreviation in the
              right-sized box beats a broken image. */}
          {team.logoUrl ? (
            <Image
              src={team.logoUrl}
              alt=""
              width={64}
              height={64}
              className="h-14 w-14 shrink-0 rounded-sm border border-rule bg-ink p-2 object-contain sm:h-[72px] sm:w-[72px]"
              unoptimized
            />
          ) : (
            <span className="display grid h-14 w-14 shrink-0 place-items-center rounded-sm border border-rule bg-ink text-sm text-body sm:h-[72px] sm:w-[72px]">
              {team.abbreviation}
            </span>
          )}
          <div>
            <h1 className="display text-2xl text-white sm:text-3xl">
              {team.city} {team.name}
            </h1>
            <p className="text-xs text-muted">
              {/* The whole body of coverage, not the ten on this page. */}
              {team.conference}ern Conference · {team.division} · {total} update
              {total === 1 ? "" : "s"}
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
            No rumors for this team yet.
          </p>
        ) : (
          <>
            {rumors.map((r) => <WireItem key={r.id} rumor={r} preview />)}
            <Pager
              page={page}
              pageCount={pageCount}
              total={total}
              noun="updates"
              hrefFor={(p) => pageHref(team.slug, p)}
            />
          </>
        )}
      </div>
    </WireShell>
  );
}
