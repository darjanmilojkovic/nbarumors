"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SILHOUETTE } from "@/lib/silhouette";
import { logoAt } from "@/lib/logo-sizes";
import type { DirectoryPlayer } from "@/lib/queries";

/**
 * The /players directory.
 *
 * It used to be one alphabetical grid of 855 names with nothing but a face and
 * a name on each, 28,000px tall. This splits it three ways a rumour reader
 * actually looks for someone: who is being written about right now, which club
 * he is at, and — as a fallback — his name.
 *
 * Everything is sent to the browser once and the toggle and filter run here.
 * 855 short rows is small, and it keeps the page static and cached rather than
 * rendering again per view.
 *
 * On trial from 29 Sep 2026. The previous page is the parent of this commit.
 */

/**
 * Which of the three designs is live.
 *
 * "cards"  — the old grid, with the club and post count added to each card.
 * "roster" — one compact box per club, players listed inside it as rows.
 * "list"   — a single ruled table: name, club, posts, last update.
 *
 * "list" went live on 29 Sep 2026, picked from the three side by side. Flip
 * this one word to switch.
 */
const LAYOUT: Layout = "list";
type Layout = "cards" | "roster" | "list";

/** How many make "Most talked about". Two rows at every breakpoint's width. */
const HOT_COUNT = 12;

type Team = {
  slug: string;
  city: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
};

type Group = {
  id: string;
  label: string;
  short: string;
  logoUrl?: string | null;
  note?: string;
  players: DirectoryPlayer[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * UTC on purpose: the server renders this first and the browser renders it
 * again, and a date formatted in each one's own timezone would disagree.
 */
function shortDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Kevin McCullar Jr." → ["Kevin", "McCullar Jr."]; a one-word name gets an empty second half. */
function splitName(name: string): [string, string] {
  const i = name.indexOf(" ");
  return i < 0 ? [name, ""] : [name.slice(0, i), name.slice(i + 1)];
}

/** "Şengün" files under S, "Ömer" under O. */
function letterOf(name: string) {
  const c = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

function fold(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * The club column's value. With no club it names the group the player sits in
 * on the team view — the same FA and PROS as the jump bar — so a prospect in
 * A–Z or a search is not passed off as a free agent.
 */
function teamLabel(p: DirectoryPlayer) {
  return p.teamAbbr ?? (p.hasPlayed ? "FA" : "PROS");
}

function meta(p: DirectoryPlayer, showTeam: boolean) {
  const parts: string[] = [];
  if (showTeam) parts.push(teamLabel(p));
  parts.push(p.posts > 0 ? `${p.posts} post${p.posts === 1 ? "" : "s"}` : "No posts yet");
  return parts.join(" · ");
}

function Headshot({ p, size }: { p: DirectoryPlayer; size: "sm" | "md" | "lg" }) {
  const cls = { sm: "h-6 w-6", md: "h-10 w-10", lg: "h-14 w-14" }[size];
  return (
    <Image
      src={p.headshotUrl ?? SILHOUETTE}
      alt=""
      width={64}
      height={47}
      className={`${cls} shrink-0 rounded-full bg-surface-2 object-cover object-top`}
      unoptimized
    />
  );
}

export function PlayersDirectory({
  players,
  teams,
}: {
  players: DirectoryPlayer[];
  teams: Team[];
}) {
  const layout: Layout = LAYOUT;
  const [view, setView] = useState<"team" | "az">("team");
  const [query, setQuery] = useState("");

  const hot = useMemo(
    () =>
      players
        .filter((p) => p.recent > 0)
        .sort((a, b) => b.recent - a.recent || (b.lastAt ?? "").localeCompare(a.lastAt ?? ""))
        .slice(0, HOT_COUNT),
    [players],
  );

  const byTeam = useMemo<Group[]>(() => {
    /*
     * Inside a club, the players being written about lead, then the rest by
     * prominence — so a roster reads stars first, not alphabetically.
     */
    const order = (a: DirectoryPlayer, b: DirectoryPlayer) =>
      b.posts - a.posts || b.prominence - a.prominence || a.fullName.localeCompare(b.fullName);

    const groups: Group[] = teams.map((t) => ({
      id: t.slug,
      label: `${t.city} ${t.name}`,
      short: t.abbreviation,
      logoUrl: t.logoUrl,
      players: players
        .filter((p) => p.teamSlug === t.slug)
        .sort(order),
    }));

    // Retired players never reach here: allPlayers() leaves them out.
    const unattached = players.filter((p) => !p.teamSlug);
    groups.push(
      {
        id: "free-agents",
        label: "Free agents",
        short: "FA",
        note: "Played in the NBA, no club right now",
        players: unattached.filter((p) => p.hasPlayed).sort(order),
      },
      {
        id: "prospects",
        label: "Prospects",
        short: "PROS",
        note: "Draft class, college and overseas — no NBA games yet",
        players: unattached.filter((p) => !p.hasPlayed).sort(order),
      },
    );
    return groups.filter((g) => g.players.length > 0);
  }, [players, teams]);

  const byLetter = useMemo<Group[]>(() => {
    const m = new Map<string, DirectoryPlayer[]>();
    for (const p of players) {
      const l = letterOf(p.fullName);
      if (!m.has(l)) m.set(l, []);
      m.get(l)!.push(p);
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([l, list]) => ({ id: `letter-${l}`, label: l, short: l, players: list }));
  }, [players]);

  const q = fold(query.trim());
  const matches = q ? players.filter((p) => fold(p.fullName).includes(q)) : null;
  const groups = view === "team" ? byTeam : byLetter;

  // The side gutters live on the page wrapper, so the h1 lines up with the list.
  return (
    <div>
      {/*
       * Phones only. From lg up the left rail carries the site search, which
       * finds players too; a second box beside it would be two ways to do one
       * thing.
       */}
      <div className="mb-6 lg:hidden">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a player"
          aria-label="Find a player"
          className="w-full appearance-none rounded-sm border border-rule bg-surface px-3 py-2 text-sm text-body placeholder:text-muted focus:border-link focus:text-white focus:outline-none"
        />
      </div>

      {matches ? (
        <section>
          <h2 className="label mb-3 text-xs text-muted">
            {matches.length} match{matches.length === 1 ? "" : "es"}
          </h2>
          <Players layout={layout} list={matches} showTeam />
        </section>
      ) : (
        <>
          {hot.length > 0 && (
            <section className="mb-9 lg:px-5">
              <h2 className="label mb-3 text-xs text-muted">Most talked about this week</h2>
              {/*
               * A sideways strip on a phone: as a grid, twelve cards filled the
               * whole first screen and pushed the directory below the fold.
               */}
              <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0 md:grid-cols-6">
                {hot.map((p) => (
                  <li key={p.slug} className="w-28 shrink-0 sm:w-auto">
                    <Link
                      href={`/player/${p.slug}`}
                      className="flex h-full flex-col items-center gap-2 rounded-sm bg-surface px-2 py-3 text-center hover:bg-surface-2"
                    >
                      <Headshot p={p} size="lg" />
                      {/*
                       * First name over the rest, always two rows, so every card's
                       * post count sits on the same line whatever the name's length.
                       */}
                      <span className="w-full text-xs font-semibold leading-tight text-white sm:text-[13px]">
                        <span className="block truncate">{splitName(p.fullName)[0]}</span>
                        <span className="block truncate">{splitName(p.fullName)[1] || " "}</span>
                      </span>
                      <span className="font-mono text-[10px] text-muted">
                        {teamLabel(p)} · {p.recent} post{p.recent === 1 ? "" : "s"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/*
           * Bled out over the page's side gutters and given a shadow. Ending at
           * the content edge on a rule like every row's, it read as one more
           * row, and the list slid under it cut in half with nothing to say so.
           */}
          <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-rule bg-ink px-4 pb-3 pt-3 shadow-[0_10px_14px_-8px_rgba(0,0,0,0.9)] sm:mx-0 sm:px-0 lg:px-5">
            <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Sort players">
              {(
                [
                  ["team", "By team"],
                  ["az", "A–Z"],
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
              <span className="ml-auto font-mono text-[11px] text-muted">
                {players.length} players
              </span>
            </div>
            {/*
             * The jump bar. Scrolls sideways on a phone rather than wrapping,
             * so it stays one line tall and the list keeps the screen; wider
             * screens have the room to show all 33 at once.
             */}
            <nav
              aria-label={view === "team" ? "Jump to team" : "Jump to letter"}
              className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible"
            >
              {groups.map((g) => (
                <a
                  key={g.id}
                  href={`#${g.id}`}
                  className="shrink-0 rounded-sm border border-rule px-1.5 py-0.5 font-mono text-[11px] text-body hover:border-link hover:text-white"
                >
                  {g.short}
                </a>
              ))}
            </nav>
          </div>

          <div className={layout === "roster" && view === "team" ? "grid gap-4 md:grid-cols-2 2xl:grid-cols-3" : ""}>
            {groups.map((g) => (
              <section
                key={g.id}
                id={g.id}
                /*
                 * Clears the sticky bar when a jump lands on the heading, with
                 * room to spare. The bar is one chip row on a phone and two
                 * from md up, where it wraps: ~110px, which the old 96px
                 * offset left the heading tucked beneath.
                 */
                className={`scroll-mt-28 md:scroll-mt-32 ${
                  layout === "roster" && view === "team"
                    ? "self-start rounded-sm border border-rule bg-surface"
                    : "mb-8 last:mb-0"
                }`}
              >
                <GroupHeading
                  group={g}
                  boxed={layout === "roster" && view === "team"}
                  inset={layout === "list"}
                />
                <Players layout={layout} list={g.players} showTeam={view === "az"} />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** `inset` lines the heading up with the list layout's padded rows. */
function GroupHeading({ group, boxed, inset }: { group: Group; boxed: boolean; inset: boolean }) {
  return (
    <div
      className={`flex items-center gap-2.5 ${
        boxed
          ? "border-b border-rule px-3 py-2.5"
          : `border-b border-rule pb-2.5 ${inset ? "mb-1 px-2 lg:px-5" : "mb-3"}`
      }`}
    >
      {group.logoUrl && (
        <Image src={logoAt(group.logoUrl, 28)} alt="" width={32} height={32} className="h-8 w-8 rounded-sm bg-body p-0.5 object-contain" unoptimized />
      )}
      <h2 className={`display text-white ${group.short.length === 1 ? "text-2xl" : "text-lg"}`}>
        {group.label}
      </h2>
      {group.note && <span className="hidden text-xs text-muted sm:inline">{group.note}</span>}
      <span className="ml-auto font-mono text-[11px] text-muted">{group.players.length}</span>
    </div>
  );
}

/** Players with nothing written about them yet recede, but stay findable. */
const quiet = (p: DirectoryPlayer) => (p.posts === 0 ? "opacity-55" : "");

function Players({
  layout,
  list,
  showTeam,
}: {
  layout: Layout;
  list: DirectoryPlayer[];
  showTeam: boolean;
}) {
  if (layout === "roster") {
    return (
      <ul>
        {list.map((p) => (
          <li key={p.slug} className={quiet(p)}>
            <Link
              href={`/player/${p.slug}`}
              className="flex items-center gap-2.5 border-b border-rule px-3 py-1.5 last:border-b-0 hover:bg-surface-2"
            >
              <Headshot p={p} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{p.fullName}</span>
              {showTeam && <span className="font-mono text-[10px] text-muted">{teamLabel(p)}</span>}
              <span className="w-8 text-right font-mono text-[11px] text-muted">{p.posts || "–"}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  if (layout === "list") {
    return (
      <table className="w-full text-left text-[13px]">
        <thead className="sr-only">
          <tr>
            <th>Player</th>
            {showTeam && <th>Team</th>}
            <th>Posts</th>
            <th>Last update</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.slug} className={`border-b border-rule hover:bg-surface ${quiet(p)}`}>
              {/* Inset at both ends, so the hover band has room around its text. */}
              <td className="py-2 pl-2 pr-3 lg:pl-5">
                <Link href={`/player/${p.slug}`} className="flex items-center gap-2.5">
                  <Headshot p={p} size="sm" />
                  <span className="truncate">{p.fullName}</span>
                </Link>
              </td>
              {showTeam && (
                <td className="w-12 font-mono text-[11px] text-muted">{teamLabel(p)}</td>
              )}
              <td className="w-20 pr-2 text-right font-mono text-[11px] text-muted sm:pr-0">
                {p.posts ? `${p.posts} post${p.posts === 1 ? "" : "s"}` : "–"}
              </td>
              <td className="hidden w-20 pr-2 text-right lg:pr-5 font-mono text-[11px] text-muted sm:table-cell">
                {shortDate(p.lastAt) ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {list.map((p) => (
        <li key={p.slug} className={quiet(p)}>
          <Link
            href={`/player/${p.slug}`}
            className="flex h-full items-center gap-2 rounded-sm bg-surface px-2 py-2 hover:bg-surface-2 sm:gap-3 sm:px-3"
          >
            <Headshot p={p} size="md" />
            <span className="min-w-0">
              <span className="block text-xs leading-tight sm:text-sm">{p.fullName}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-muted">
                {meta(p, showTeam)}
                {/* Dropped on a phone, where two columns leave room for one line. */}
                {p.lastAt && <span className="hidden sm:inline"> · {shortDate(p.lastAt)}</span>}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
