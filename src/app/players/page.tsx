import type { Metadata } from "next";
import { PlayersDirectory } from "@/components/PlayersDirectory";
import { WireShell } from "@/components/WireShell";
import { allPlayers, allTeams } from "@/lib/queries";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "All players",
  description:
    "Every NBA player we track, with the trade rumors, contract news and signing reports filed on each.",
  alternates: { canonical: "/players" },
};

export default async function PlayersPage() {
  const [players, teams] = await Promise.all([allPlayers(), allTeams()]);

  return (
    <WireShell>
      {/*
       * Wider gutters than the feed: rows of text need air between the rails.
       * The left rule mirrors the right rail's border-l, which the extra
       * gutter otherwise left looking one-sided.
       */}
      <div className="px-4 pt-8 sm:px-0 lg:border-l lg:border-rule lg:pl-8 xl:pr-8">
        <h1 className="display mb-6 text-2xl text-white sm:text-3xl">All Players</h1>
        <PlayersDirectory
          players={players}
          // By city, not by conference as on /teams: the jump bar reads as one run.
          teams={[...teams]
            .sort((a, b) => a.city.localeCompare(b.city))
            .map((t) => ({
              slug: t.slug,
              city: t.city,
              name: t.name,
              abbreviation: t.abbreviation,
              logoUrl: t.logoUrl,
            }))}
        />
      </div>
    </WireShell>
  );
}
