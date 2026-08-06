import Image from "next/image";
import Link from "next/link";
import { allTeams } from "@/lib/queries";

export const revalidate = 3600;

export default async function TeamsPage() {
  const teams = await allTeams();
  const east = teams.filter((t) => t.conference === "East");
  const west = teams.filter((t) => t.conference === "West");

  return (
    <div className="px-4 sm:px-0">
      <h1 className="display mb-6 text-2xl text-white sm:text-3xl">All Teams</h1>
      {[
        { label: "Eastern Conference", list: east },
        { label: "Western Conference", list: west },
      ].map((group) => (
        <section key={group.label} className="mb-8">
          <h2 className="display mb-3 text-sm text-muted">{group.label}</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.list.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/team/${t.slug}`}
                  className="flex items-center gap-3 rounded-sm bg-surface px-3 py-2 hover:bg-surface-2"
                >
                  <Image
                    src={t.logoUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 object-contain"
                    unoptimized
                  />
                  <span className="text-sm">
                    {t.city} {t.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
