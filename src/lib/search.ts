import { sql } from "drizzle-orm";
import { db } from "@/db";
import { headshotFor } from "@/lib/images";
import {
  EMPTY_RESULTS,
  MIN_QUERY,
  type SearchResults,
} from "@/lib/search-shared";

export { EMPTY_RESULTS, MIN_QUERY };
export type { SearchResults };

/**
 * Site search, in two tiers.
 *
 * Most of what anyone types here is a name — "LeBron", "Lakers" — and the
 * answer they want is that player's or that team's page, not a list of posts
 * mentioning them. So entities are matched first and reported separately, and
 * posts come underneath as the fallback rather than the main event.
 *
 * Deliberately `ilike` rather than a tsvector column and a GIN index.
 *
 * The whole published corpus is 182KB across 706 posts averaging 218
 * characters, plus 1,201 players and 30 teams. Postgres scans that in
 * single-digit milliseconds, so full-text machinery would buy nothing today and
 * costs a migration against a database shared with production. `ilike` also
 * does the one thing full text is bad at: matching a fragment mid-word, which
 * is what a search-as-you-type box sends on every keystroke.
 *
 * The point at which this stops being true is a corpus a couple of orders of
 * magnitude larger. Until then this is the cheaper correct answer, not a
 * shortcut.
 */

/**
 * `%` and `_` are wildcards to LIKE, so a query containing them would match far
 * more than it looks like it should. Backslash-escaped against the default
 * escape character.
 */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function searchSite(
  query: string,
  limit = 5,
): Promise<SearchResults> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return EMPTY_RESULTS;
  const term = likeTerm(q);

  /*
   * Three independent lookups rather than one union, because each ranks by
   * something different and none of them is big enough for the round trips to
   * matter.
   */
  const [playerRows, teamRows, rumorRows] = await Promise.all([
    db.execute(sql`
      select p.slug, p.full_name, p.prominence, p.nba_player_id,
             t.city || ' ' || t.name as team_name
      from players p
      left join teams t on t.id = p.current_team_id
      /*
       * Aliases as well as the display name, because nobody types the
       * diacritics. We store "Luka Doncic" with a hacek, which ilike on the
       * ASCII spelling does not match: searching his surname returned six
       * reports, whose headlines are written plainly, and not the player
       * himself. The same held for Jokic, Vucevic, Sengun and Valanciunas.
       *
       * The alias array already carries the folded spelling, so this needs no
       * unaccent extension and no migration.
       *
       * No backticks in this comment: it sits inside a JS template literal,
       * and one would end the string.
       */
      where p.full_name ilike ${term}
         or exists (
           select 1 from unnest(p.aliases) alias where alias ilike ${term}
         )
      -- The best-known match first: a search for "curry" means Stephen.
      order by p.prominence desc, p.full_name asc
      limit ${limit}
    `),
    db.execute(sql`
      select slug, name, city, abbreviation
      from teams
      where city || ' ' || name ilike ${term}
         or abbreviation ilike ${term}
         or name ilike ${term}
      order by city asc
      limit 3
    `),
    db.execute(sql`
      select slug, headline, published_at
      from rumors
      where is_published
        and (headline ilike ${term} or body ilike ${term})
      /*
       * A headline hit is what the story is about; a body hit is a passing
       * mention. Ordering by that first keeps the on-topic posts on top
       * without needing a relevance score.
       */
      order by (headline ilike ${term}) desc, published_at desc
      limit ${limit + 1}
    `),
  ]);

  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as T[];

  return {
    players: rows<{
      slug: string;
      full_name: string;
      prominence: number;
      nba_player_id: string | null;
      team_name: string | null;
    }>(playerRows).map((p) => ({
      slug: p.slug,
      fullName: p.full_name,
      prominence: Number(p.prominence) || 0,
      headshotUrl: headshotFor(p.nba_player_id),
      teamName: p.team_name,
    })),
    teams: rows<{
      slug: string;
      name: string;
      city: string;
      abbreviation: string;
    }>(teamRows),
    rumors: rows<{ slug: string; headline: string; published_at: string }>(
      rumorRows,
    ).map((r) => ({
      slug: r.slug,
      headline: r.headline,
      publishedAt: String(r.published_at),
    })),
  };
}
