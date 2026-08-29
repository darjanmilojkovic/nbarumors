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

/**
 * Which of the three designs is live.
 *
 * "labelled" — a rail heading above a bordered field, so the block reads like
 *              the beats and the team chips: label, then content.
 * "bare"     — the same field with no heading.
 * "inline"   — no chrome at all; a line of text that happens to be an input,
 *              with a rule appearing on focus.
 *
 * All three are on trial from 29 Aug 2026. Flip this one word to switch. None
 * of them is a card — that was tried first and rejected for importing the
 * right rail's language into a column that speaks in bare links and chips.
 */
const SEARCH_VARIANT: "labelled" | "bare" | "inline" = "labelled";

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

  /*
   * Results are a bare list in both variants, indented to the rail's own text.
   *
   * They used to live inside a card, and the card was the reason the whole
   * thing read as an import from the right rail. Without it they flow down the
   * rail exactly as the beats list above them does, which is the language this
   * column already speaks.
   */
  const rowClass =
    "flex items-center gap-2.5 border-b border-rule py-2.5 last:border-b-0 hover:bg-surface";

  const results_list = active && (
    <div className="mt-1 border-t border-rule">
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
            <span className="block font-mono text-[10px] text-muted">Team</span>
          </span>
        </Link>
      ))}

      {results.rumors.map((r) => (
        <Link
          key={r.slug}
          href={`/rumor/${r.slug}`}
          onClick={() => setQuery("")}
          className="block border-b border-rule py-2.5 last:border-b-0 hover:bg-surface"
        >
          <span className="line-clamp-2 text-[13px] leading-snug text-body">
            {r.headline}
          </span>
        </Link>
      ))}

      {found === 0 && (
        <p className="py-3 text-xs text-muted">
          {loading ? "Searching…" : `Nothing for “${trimmed}”.`}
        </p>
      )}
    </div>
  );

  /*
   * Variants A and B — the field keeps its own border, the card around it is
   * gone. B adds the rail's own heading above it.
   *
   * The border is affordance rather than decoration: it is what says this is
   * something you type into. Only the card wrapper mimicked the right rail, so
   * only the card wrapper goes.
   *
   * B's heading is written out rather than imported from WireShell, where
   * RailHeading lives: exporting it to a client component would pull the whole
   * server module across the boundary. The classes are copied verbatim, so a
   * change to one wants the same change to the other.
   */
  if (SEARCH_VARIANT === "bare" || SEARCH_VARIANT === "labelled") {
    return (
      <div className="mb-7">
        {SEARCH_VARIANT === "labelled" && (
          <h2 className="label mb-3 text-[11px] text-muted">Search</h2>
        )}
        <div className="relative">
          <i
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          >
            <SearchGlyph />
          </i>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            /*
             * The heading already says "Search", so the placeholder in B says
             * what can be searched instead of repeating it.
             */
            placeholder={
              SEARCH_VARIANT === "labelled" ? "Player, team or report" : "Search"
            }
            aria-label="Search players, teams and reports"
            /*
             * `appearance-none` removes Safari's inset search styling, which
             * otherwise overrides the border and background below.
             */
            className="w-full appearance-none rounded-sm border border-rule bg-surface py-1.5 pl-8 pr-2.5 text-[13px] text-body placeholder:text-muted focus:border-link focus:text-white focus:outline-none"
          />
        </div>
        {results_list}
      </div>
    );
  }

  /*
   * Variant D — no chrome at all until it is used.
   *
   * A real input throughout rather than a button that swaps itself for one:
   * the caret, the keyboard and the screen-reader label all keep working, and
   * there is no state to get wrong. It only looks like a line of text.
   *
   * The rule appears on focus, because without a border nothing else confirms
   * that the click landed.
   */
  return (
    <div className="mb-7">
      <div className="group flex items-center gap-2 border-b border-transparent py-1 focus-within:border-rule">
        <span aria-hidden="true" className="shrink-0 text-muted">
          <SearchGlyph />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search players, teams…"
          aria-label="Search players, teams and reports"
          className="w-full appearance-none border-0 bg-transparent p-0 text-[13px] text-body placeholder:text-muted focus:text-white focus:outline-none"
        />
      </div>
      {results_list}
    </div>
  );
}

/**
 * Drawn here rather than pulled from a library: it is the only icon on the
 * site, and an icon dependency for one glyph is not worth the bytes.
 */
function SearchGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 L14 14" />
    </svg>
  );
}
