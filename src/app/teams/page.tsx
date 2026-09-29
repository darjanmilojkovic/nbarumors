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
      {/* Wider gutters than the feed: rows of text need air between the rails. */}
      <div className="px-4 pt-8 sm:px-0 lg:pl-8 xl:pr-8">
        <h1 className="display mb-6 text-2xl text-white sm:text-3xl">All Teams</h1>
        <TeamsDirectory teams={teams} />
      </div>
    </WireShell>
  );
}
