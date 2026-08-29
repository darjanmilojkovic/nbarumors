/**
 * The search contract, shared by the server query and the client card.
 *
 * Separate from `search.ts` on purpose: that module imports the database
 * client, and a `"use client"` component importing a type from it would drag
 * Drizzle and the Neon driver into the browser bundle. Nothing here imports
 * anything.
 */

export type SearchResults = {
  players: {
    slug: string;
    fullName: string;
    prominence: number;
    headshotUrl: string | null;
    teamName: string | null;
  }[];
  teams: { slug: string; name: string; city: string; abbreviation: string }[];
  rumors: { slug: string; headline: string; publishedAt: string }[];
};

export const EMPTY_RESULTS: SearchResults = {
  players: [],
  teams: [],
  rumors: [],
};

/** Below two characters every query matches most of the league. */
export const MIN_QUERY = 2;
