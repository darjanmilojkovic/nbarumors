import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { WireShell } from "@/components/WireShell";
import { allPlayers } from "@/lib/queries";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "All players",
  description:
    "Every NBA player we track, with the trade rumors, contract news and signing reports filed on each.",
  alternates: { canonical: "/players" },
};

export default async function PlayersPage() {
  const players = await allPlayers();

  return (
    <WireShell>
      <div className="px-4 pt-8 sm:px-0">
      <h1 className="display mb-6 text-2xl text-white sm:text-3xl">All Players</h1>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {players.map((p) => (
          <li key={p.slug}>
            <Link
              href={`/player/${p.slug}`}
              className="flex items-center gap-2 rounded-sm bg-surface px-2 py-2 hover:bg-surface-2 sm:gap-3 sm:px-3"
            >
              {p.headshotUrl ? (
                <Image
                  src={p.headshotUrl}
                  alt=""
                  width={64}
                  height={47}
                  className="h-10 w-10 shrink-0 rounded-full bg-surface-2 object-cover object-top"
                  unoptimized
                />
              ) : (
                // No NBA id yet — a name we only know from a rumor.
                <span
                  aria-hidden
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-xs text-muted"
                >
                  {p.fullName
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </span>
              )}
              <span className="min-w-0 text-xs leading-tight sm:text-sm">
                {p.fullName}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      </div>
    </WireShell>
  );
}
