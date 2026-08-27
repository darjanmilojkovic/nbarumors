import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { cacheHeadshot, nbaHeadshotSourceUrl } from "@/lib/images";

/**
 * Give names we only know from rumors a real identity: an NBA id, and with it
 * a headshot and a place on /players.
 *
 * Ids used to come only from the league-leaders endpoint, which lists players
 * who met a minimum games/minutes threshold. Anyone who missed enough of the
 * season was invisible to it. The obvious fixes are all shut — playerindex,
 * commonallplayers, the CDN's static player index and data.nba.net every
 * refuse us, with or without browser headers. Wikidata publishes the same
 * mapping as property P3647 and is happy to be queried, so that is where the
 * ids come from.
 *
 * This ran as a hand-run script over active players only, which left out
 * exactly the players it was most needed for. Ben Simmons is not on anyone's
 * roster, so he had no id, no photo and no listing — while a Kings scout
 * watching him work out was on the front page. He was one of 118 players with
 * published rumors and no listing, Kyrie Irving among them.
 *
 * Now it runs daily against anyone we actually write about.
 */

const SPARQL = `
SELECT ?label ?nbaId WHERE {
  ?p wdt:P3647 ?nbaId .
  ?p rdfs:label ?label .
  FILTER(LANG(?label) = "en")
}`;

/** Same normalisation the stats sync uses, so the two agree on a name. */
const key = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * German and Nordic transliteration. Stripping the umlaut from "Pöltl" gives
 * "poltl", but the NBA spells him "Poeltl" — the two normalisations disagree
 * and the match is lost. Expanding the vowel instead recovers it.
 */
const transliterate = (name: string) =>
  name
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ä/gi, "ae")
    .replace(/ø/gi, "oe")
    .replace(/å/gi, "aa")
    .replace(/ß/g, "ss");

/** "Jr.", "Sr.", "II", "III", "IV" — carried inconsistently by both sides. */
const dropSuffix = (k: string) => k.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "").trim();

/**
 * Every spelling a name might reasonably be indexed under, most confident
 * first. Matching walks these in order so an exact hit always beats a
 * suffix-stripped one.
 */
function variants(name: string): string[] {
  const base = key(name);
  const trans = key(transliterate(name));
  return [...new Set([base, trans, dropSuffix(base), dropSuffix(trans)])].filter(Boolean);
}

/** "mo bamba" -> "m bamba", so a nickname can still find a legal first name. */
const initialKey = (k: string) => {
  const parts = dropSuffix(k).split(" ");
  if (parts.length < 2) return null;
  return `${parts[0][0]} ${parts[parts.length - 1]}`;
};

async function fetchWikidata(): Promise<Map<string, string[]>> {
  const res = await fetch(
    `https://query.wikidata.org/sparql?query=${encodeURIComponent(SPARQL)}`,
    {
      headers: {
        Accept: "application/sparql-results+json",
        // Wikidata asks for a contactable agent; anonymous clients get throttled.
        "User-Agent": "nbarumors.cc/0.1 (https://nbarumors.cc; darjan@melomel.com)",
      },
    },
  );
  if (!res.ok) throw new Error(`wikidata ${res.status}`);
  const json = (await res.json()) as {
    results: { bindings: { label: { value: string }; nbaId: { value: string } }[] };
  };

  const byName = new Map<string, string[]>();
  const add = (k: string | null, id: string) => {
    if (!k) return;
    const seen = byName.get(k) ?? [];
    if (!seen.includes(id)) byName.set(k, [...seen, id]);
  };

  for (const b of json.results.bindings) {
    for (const v of variants(b.label.value)) add(v, b.nbaId.value);
    // Indexed separately so a nickname match can never outrank a real one.
    add(initialKey(key(b.label.value)), b.nbaId.value);
  }
  return byName;
}

/** A photo that 404s is worse than the initials fallback, so check first. */
async function hasHeadshot(id: string): Promise<boolean> {
  try {
    const res = await fetch(nbaHeadshotSourceUrl(id), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

export type DiscoverResult = {
  candidates: number;
  matched: number;
  cached: number;
  ambiguous: number;
  /** Matched an id another row already holds — see the check in the loop. */
  taken: number;
  noPhoto: number;
  samples: string[];
};

export async function discoverPlayers(
  opts: { dryRun?: boolean; cacheImages?: boolean } = {},
): Promise<DiscoverResult> {
  const dryRun = opts.dryRun ?? false;
  /*
   * Off in the cron. Vercel's filesystem is read-only at runtime, so there is
   * nowhere to put the resized file — the id still gets recorded, and the next
   * deploy's prebuild turns it into an image. See package.json.
   */
  const cacheImages = opts.cacheImages ?? false;

  /*
   * Anyone we actually write about, not just anyone on a roster. The rumor
   * join is the whole point: a player is worth identifying precisely because
   * he turned up in a story, whether or not he is signed anywhere.
   */
  const candidates = await db
    .select({ id: players.id, fullName: players.fullName })
    .from(players)
    .where(
      sql`${players.nbaPlayerId} is null and (
        ${players.isActive} or exists (
          select 1 from rumor_players rp
            join rumors r on r.id = rp.rumor_id and r.is_published
           where rp.player_id = ${players.id}
        )
      )`,
    );

  if (candidates.length === 0) {
    return {
      candidates: 0,
      matched: 0,
      cached: 0,
      ambiguous: 0,
      taken: 0,
      noPhoto: 0,
      samples: [],
    };
  }

  const byName = await fetchWikidata();

  /*
   * Ids already spoken for. dropSuffix matches "Walter Clayton" to the
   * Wikidata entry for "Walter Clayton Jr." — the right answer where that row
   * is him, the wrong one where a fuller row already holds the id and this is
   * the extraction's second copy of the same person. Writing it there is how
   * the two halves of a split player came to agree on an id while staying two
   * rows, and it is now a unique-index violation besides.
   */
  const claimed = new Set(
    (
      await db
        .select({ nbaPlayerId: players.nbaPlayerId })
        .from(players)
        .where(sql`${players.nbaPlayerId} is not null`)
    ).map((r) => r.nbaPlayerId as string),
  );

  let matched = 0;
  let cached = 0;
  let ambiguous = 0;
  let taken = 0;
  let noPhoto = 0;
  const samples: string[] = [];

  for (const p of candidates) {
    /*
     * Exact spellings first, then transliterations, then suffix-stripped, and
     * only if all of those miss, first-initial + surname. The last is how "Mo
     * Bamba" reaches "Mohamed Bamba", but it is also the one that could pair
     * two different people, so it runs last and still has to survive the
     * uniqueness and photo checks below.
     */
    let ids: string[] | undefined;
    let how = "exact";
    for (const v of variants(p.fullName)) {
      ids = byName.get(v);
      if (ids?.length) break;
    }
    if (!ids?.length) {
      ids = byName.get(initialKey(key(p.fullName)) ?? "");
      how = "initial";
    }
    if (!ids?.length) continue;

    /*
     * Two people can share a name — a father and son, or two eras. Rather than
     * guess, keep only the ids that actually resolve to a photo, and give up if
     * that still leaves more than one.
     */
    const usable: string[] = [];
    for (const id of ids) if (await hasHeadshot(id)) usable.push(id);

    if (usable.length === 0) {
      noPhoto++;
      continue;
    }
    if (usable.length > 1) {
      ambiguous++;
      continue;
    }

    if (claimed.has(usable[0])) {
      taken++;
      if (samples.length < 10) {
        samples.push(`${p.fullName} → ${usable[0]} already taken, skipped`);
      }
      continue;
    }

    matched++;
    claimed.add(usable[0]);
    if (samples.length < 10) samples.push(`${p.fullName} → ${usable[0]} (${how})`);
    if (dryRun) continue;

    const headshotUrl = cacheImages ? await cacheHeadshot(usable[0]) : null;
    if (headshotUrl) cached++;

    /*
     * The id is written either way; the URL only when a file backs it. A row
     * pointing at a headshot that is not in the deploy renders a broken image,
     * where a null renders initials.
     */
    await db
      .update(players)
      .set(headshotUrl ? { nbaPlayerId: usable[0], headshotUrl } : { nbaPlayerId: usable[0] })
      .where(eq(players.id, p.id));
  }

  return {
    candidates: candidates.length,
    matched,
    cached,
    ambiguous,
    taken,
    noPhoto,
    samples,
  };
}
