"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { DirectoryTeam } from "@/lib/queries";

/**
 * The /teams directory.
 *
 * It used to be two conferences of bare logo-and-name tiles, which told a
 * reader nothing they could not get from the league. Now each club is a row
 * with how much has been written about it this week and the latest headline,
 * grouped the way the league itself is — conference, then division — with a
 * second view that ranks all thirty by activity.
 *
 * Rows are ruled like the players directory's list, so the two directories
 * read as one piece.
 *
 * On trial from 29 Sep 2026. The previous page is the parent of this commit.
 */

const CONFERENCES = [
  { key: "East", label: "Eastern Conference", divisions: ["Atlantic", "Central", "Southeast"] },
  { key: "West", label: "Western Conference", divisions: ["Northwest", "Pacific", "Southwest"] },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** UTC so the server's render and the browser's agree. */
function shortDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function TeamsDirectory({ teams }: { teams: DirectoryTeam[] }) {
  const [view, setView] = useState<"division" | "active">("division");

  const ranked = useMemo(
    () => [...teams].sort((a, b) => b.week - a.week || b.total - a.total),
    [teams],
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-1 border-b border-rule pb-2.5 lg:px-5" role="tablist" aria-label="Arrange teams">
        {(
          [
            ["division", "By division"],
            ["active", "Most active"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded-sm px-3 py-1 text-xs font-semibold ${
              view === v ? "bg-link text-white" : "text-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted">Posts this week</span>
      </div>

      {view === "division" ? (
        CONFERENCES.map((c) => (
          <section key={c.key} className="mb-10">
            <h2 className="display mb-4 text-xl text-white lg:px-5">{c.label}</h2>
            {c.divisions.map((d) => (
              <div key={d} className="mb-6">
                <h3 className="label mb-1 border-b border-rule px-2 pb-2 text-[11px] text-muted lg:px-5">
                  {d}
                </h3>
                <ul>
                  {teams
                    .filter((t) => t.conference === c.key && t.division === d)
                    .map((t) => (
                      <TeamRow key={t.slug} team={t} />
                    ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      ) : (
        <ul>
          {ranked.map((t, i) => (
            <TeamRow key={t.slug} team={t} rank={i + 1} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamRow({ team: t, rank }: { team: DirectoryTeam; rank?: number }) {
  return (
    <li className={`flex items-center gap-3 border-b border-rule px-2 py-2.5 hover:bg-surface lg:px-5 ${t.week === 0 ? "opacity-70" : ""}`}>
      {rank !== undefined && (
        <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted">{rank}</span>
      )}
      <Link href={`/team/${t.slug}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
        {t.logoUrl ? (
          <Image src={t.logoUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-sm bg-body p-1 object-contain" unoptimized />
        ) : (
          <span className="grid h-8 w-8 place-items-center font-mono text-[10px] text-muted">{t.abbreviation}</span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/team/${t.slug}`} className="block text-sm font-semibold text-white hover:underline">
          {t.city} {t.name}
          {rank !== undefined && (
            <span className="ml-2 font-mono text-[10px] font-normal text-muted">{t.division}</span>
          )}
        </Link>
        {t.latestSlug && (
          <Link
            href={`/rumor/${t.latestSlug}`}
            className="mt-0.5 block truncate text-xs text-muted hover:text-body"
          >
            <span className="font-mono text-[10px]">{shortDate(t.latestAt)}</span> · {t.latestHeadline}
          </Link>
        )}
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-sm text-body">
        {t.week || <span className="text-muted">–</span>}
      </span>
    </li>
  );
}
