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
      teamSlug={team.slug}
    >
      <div className="mb-6 flex items-center gap-4 px-4 pt-8 sm:px-0">
        {/* Every mark is committed, so the fallback should never render — but
            the manifest decides what is on disk, and an abbreviation in the
            right-sized box beats a broken image. */}
        {team.logoUrl ? (
          <Image
            src={team.logoUrl}
            alt=""
            width={64}
            height={64}
            className="h-12 w-12 object-contain sm:h-16 sm:w-16"
            unoptimized
          />
        ) : (
          <span className="display grid h-12 w-12 place-items-center rounded-sm bg-surface-2 text-sm text-body sm:h-16 sm:w-16">
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
