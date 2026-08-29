"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EMPTY_RESULTS, MIN_QUERY, type SearchResults } from "@/lib/search-shared";

/**
 * The rail's search card.
 *
 * Built to the same shape as "Most mentioned" beside it — bordered card, ruled
 * header, `label` heading with a mono note on the right — so it reads as part
 * of the furniture rather than a control bolted on. The input sits where that
 * card's first row sits.
 *
 * Results expand inside the card rather than floating over the page. A rail is
 * narrow and already scrolls with the reader; an overlay would need collision
 * handling against the feed for no gain, and inline results cannot be clipped
 * by the sticky ancestor this lives in.
 *
 * Desktop only for now, and that falls out of where it is placed: the left rail
 * is `hidden lg:block`, so this never renders on a phone. Mobile search wants a
 * different affordance than a permanently-open field in a hidden column.
 */

/**
 * Long enough that typing a name is one request rather than eight, short enough
 * that the list feels attached to the keyboard.
 */
const DEBOUNCE_MS = 180;

export function SearchBox() {
  const [query, setQuery] = useState("");
  /*
   * Results carry the query they answer, rather than being cleared when the
   * query changes.
   *
   * Two things fall out of that and both matter. Nothing has to reset state as
   * the reader types — a stale answer simply stops matching and is ignored —
   * and "loading" stops being state at all: it is just the gap between what was
   * typed and what has been answered. Clearing it instead meant writing state
   * synchronously inside the effect, which cascades renders on every keystroke.
   */
  const [answered, setAnswered] = useState<{
    query: string;
    data: SearchResults;
  }>({ query: "", data: EMPTY_RESULTS });
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const active = trimmed.length >= MIN_QUERY;
  const results = answered.query === trimmed ? answered.data : EMPTY_RESULTS;
  const loading = active && answered.query !== trimmed;

  useEffect(() => {
    if (!active) return;

    /*
     * Both a debounce and an abort. The debounce stops a request per keystroke;
     * the abort stops a slow early response from overwriting a fast later one,
     * which is how a search box ends up showing results for a prefix of what
     * the reader actually typed.
     */
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as SearchResults;
        setAnswered({ query: trimmed, data });
      } catch (err) {
        // An abort is the expected path on every keystroke, not a failure.
        if ((err as Error)?.name !== "AbortError") {
          setAnswered({ query: trimmed, data: EMPTY_RESULTS });
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, active]);

  /** The destination Enter should take, in the order the list is rendered. */
  const firstHref =
    results.players[0] !== undefined
      ? `/player/${results.players[0].slug}`
      : results.teams[0] !== undefined
        ? `/team/${results.teams[0].slug}`
        : results.rumors[0] !== undefined
          ? `/rumor/${results.rumors[0].slug}`
          : null;

  const found =
    results.players.length + results.teams.length + results.rumors.length;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Enter" && firstHref) {
      e.preventDefault();
      setQuery("");
      router.push(firstHref);
    }
  }

  const rowClass =
    "flex items-center gap-2.5 border-b border-rule px-3.5 py-2.5 last:border-b-0 hover:bg-surface-2";

  return (
    <section className="mb-7 overflow-hidden rounded-sm border border-rule bg-surface">
      <div className="flex items-baseline justify-between border-b border-rule px-3.5 py-2.5">
        <h3 className="label text-xs">Search</h3>
        {/*
         * Empty until there is something to say. The corpus size used to sit
         * here, in the slot "7d" occupies on the card opposite, but a total
         * that never changes is a label rather than information.
         */}
        {active && (
          <span className="font-mono text-[10px] text-muted">
            {found} hit{found === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="px-3.5 py-2.5">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Player, team or report"
          aria-label="Search players, teams and reports"
          /*
           * `appearance-none` removes Safari's inset search styling, which
           * otherwise overrides the border and background below.
           */
          className="w-full appearance-none rounded-sm border border-rule bg-surface-2 px-2.5 py-1.5 text-[13px] text-body placeholder:text-muted focus:border-link focus:text-white focus:outline-none"
        />
      </div>

      {active && (
        <div className="border-t border-rule">
          {results.players.map((p) => (
            <Link
              key={p.slug}
              href={`/player/${p.slug}`}
              onClick={() => setQuery("")}
              className={rowClass}
            >
              {p.headshotUrl ? (
                <Image
                  src={p.headshotUrl}
                  alt=""
                  width={64}
                  height={47}
                  className="h-8 w-8 shrink-0 rounded-full bg-surface-2 object-cover object-top"
                  unoptimized
                />
              ) : (
                <span className="h-8 w-8 shrink-0 rounded-full bg-surface-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {p.fullName}
                </span>
                <span className="block truncate font-mono text-[10px] text-muted">
                  {p.teamName ?? "Free agent"}
                </span>
              </span>
            </Link>
          ))}

          {results.teams.map((t) => (
            <Link
              key={t.slug}
              href={`/team/${t.slug}`}
              onClick={() => setQuery("")}
              className={rowClass}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[10px] text-muted">
                {t.abbreviation}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {t.city} {t.name}
                </span>
                <span className="block font-mono text-[10px] text-muted">
                  Team
                </span>
              </span>
            </Link>
          ))}

          {results.rumors.map((r) => (
            <Link
              key={r.slug}
              href={`/rumor/${r.slug}`}
              onClick={() => setQuery("")}
              className="block border-b border-rule px-3.5 py-2.5 last:border-b-0 hover:bg-surface-2"
            >
              <span className="line-clamp-2 text-[13px] text-body">
                {r.headline}
              </span>
            </Link>
          ))}

          {found === 0 && (
            <p className="px-3.5 py-4 text-xs text-muted">
              {loading ? "Searching…" : `Nothing for “${trimmed}”.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
