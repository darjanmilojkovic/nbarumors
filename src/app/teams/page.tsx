import type { Metadata } from "next";
import { TeamsDirectory } from "@/components/TeamsDirectory";
import { WireShell } from "@/components/WireShell";
import { teamsDirectory } from "@/lib/queries";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "All teams",
  description:
    "Every NBA team, with the latest trade rumors, signings and roster moves for each.",
  alternates: { canonical: "/teams" },
};

export default async function TeamsPage() {
  const teams = await teamsDirectory();

  return (
    <WireShell>
      {/*
       * From lg up the gutter is 20px inside each block, as on a rumor card
       * (`sm:px-5`), not on this wrapper: rows span the column so their hover
       * band runs rule to rule, and their contents sit where the feed's do.
       * The left rule mirrors the right rail's border-l.
       */}
      <div className="px-4 pt-8 sm:px-0">
        <h1 className="display mb-6 text-2xl text-white sm:text-3xl lg:px-5">All Teams</h1>
        <TeamsDirectory teams={teams} />
      </div>
    </WireShell>
  );
}
