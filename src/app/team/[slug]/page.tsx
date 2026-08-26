import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cache } from "react";
import { WireItem } from "@/components/WireItem";
import { WireShell } from "@/components/WireShell";
import { rumorsForTeam, teamBySlug } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 300;

/** Deduped so the metadata lookup is not a second round trip. */
const getTeam = cache(teamBySlug);

export async function generateMetadata({
  params,
}: PageProps<"/team/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const team = await getTeam(slug);
  if (!team) return {};

  const name = `${team.city} ${team.name}`;
  const description = `${name} trade rumors, signings and roster moves, gathered from around the league and updated through the day.`;

  return {
    title: `${name} rumors`,
    description,
    alternates: { canonical: `/team/${team.slug}` },
    openGraph: {
      title: `${name} rumors`,
      description,
      url: `${SITE.url}/team/${team.slug}`,
    },
  };
}

export default async function TeamPage({ params }: PageProps<"/team/[slug]">) {
  const { slug } = await params;
  const team = await getTeam(slug);
  if (!team) notFound();

  const rumors = await rumorsForTeam(slug);

  return (
    <WireShell
      teamLabel={`${team.city} ${team.name}`}
      teamSlug={team.slug}
    >
      <div className="mb-6 flex items-center gap-4 px-4 pt-8 sm:px-0">
        <Image
          src={team.logoUrl}
          alt=""
          width={64}
          height={64}
          className="h-12 w-12 object-contain sm:h-16 sm:w-16"
          unoptimized
        />
        <div>
          <h1 className="display text-2xl text-white sm:text-3xl">
            {team.city} {team.name}
          </h1>
          <p className="text-xs text-muted">
            {team.conference}ern Conference · {team.division} · {rumors.length} update
            {rumors.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      {/* Same panel the feed uses, so the column is ruled on all four sides. */}
      <div className="border-x border-rule bg-surface">
        {rumors.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted">
            No rumors for this team yet.
          </p>
        ) : (
          rumors.map((r) => <WireItem key={r.id} rumor={r} />)
        )}
      </div>
    </WireShell>
  );
}
