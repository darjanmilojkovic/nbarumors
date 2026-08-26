import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cache } from "react";
import { WireItem } from "@/components/WireItem";
import { WireShell } from "@/components/WireShell";
import { playerBySlug, rumorsForPlayer } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 300;

/** Deduped so the metadata lookup is not a second round trip. */
const getPlayer = cache(playerBySlug);

export async function generateMetadata({
  params,
}: PageProps<"/player/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const player = await getPlayer(slug);
  if (!player) return {};

  const description = `${player.fullName} trade rumors, contract news and signing reports, gathered from around the league and updated through the day.`;

  return {
    title: `${player.fullName} rumors`,
    description,
    alternates: { canonical: `/player/${player.slug}` },
    openGraph: {
      title: `${player.fullName} rumors`,
      description,
      url: `${SITE.url}/player/${player.slug}`,
    },
  };
}

export default async function PlayerPage({ params }: PageProps<"/player/[slug]">) {
  const { slug } = await params;
  const player = await getPlayer(slug);
  if (!player) notFound();

  const rumors = await rumorsForPlayer(slug);

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
            {rumors.length} update{rumors.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      {/* Same panel the feed uses, so the column is ruled on all four sides. */}
      <div className="border-x border-rule bg-surface">
        {rumors.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted">
            Nothing on this player yet.
          </p>
        ) : (
          rumors.map((r) => <WireItem key={r.id} rumor={r} />)
        )}
      </div>
    </WireShell>
  );
}
