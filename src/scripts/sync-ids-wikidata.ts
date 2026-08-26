import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * Fill in missing NBA player ids — and therefore headshots — from Wikidata.
 *
 * Ids used to come only from the league-leaders endpoint, which lists players
 * who met a minimum games/minutes threshold. Anyone who missed enough of the
 * season was invisible to it: Joel Embiid had no id, no photo and prominence 0,
 * and he was one of 213 active players in that state — 37% of the league.
 *
 * The obvious fixes are all shut: playerindex, commonallplayers, the CDN's
 * static player index and data.nba.net every refuse us, with or without
 * browser headers. Wikidata publishes the same mapping as property P3647 and
 * is happy to be queried, so that is where the ids come from now.
 *
 * The headshot CDN itself was never blocked — only the lookup was.
 *
 *   npm run sync:ids -- --dry    preview
 *   npm run sync:ids             apply
 */

const SPARQL = `
SELECT ?label ?nbaId WHERE {
  ?p wdt:P3647 ?nbaId .
  ?p rdfs:label ?label .
  FILTER(LANG(?label) = "en")
}`;

const headshot = (id: string) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`;

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
const dropSuffix = (k: string) =>
  k.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "").trim();

/**
 * Every spelling a name might reasonably be indexed under, most confident
 * first. Matching walks these in order so an exact hit always beats a
 * suffix-stripped one.
 */
function variants(name: string): string[] {
  const base = key(name);
  const trans = key(transliterate(name));
  return [...new Set([base, trans, dropSuffix(base), dropSuffix(trans)])].filter(
    Boolean,
  );
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

/** A photo that 404s is worse than the team-logo fallback, so check first. */
async function hasHeadshot(id: string): Promise<boolean> {
  try {
    const res = await fetch(headshot(id), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { players } = await import("@/db/schema");

  const missing = await db
    .select({ id: players.id, slug: players.slug, fullName: players.fullName })
    .from(players)
    .where(sql`${players.isActive} and ${players.nbaPlayerId} is null`);

  console.log(`${missing.length} active players without an NBA id`);
  const byName = await fetchWikidata();
  console.log(`wikidata: ${byName.size} names carrying an NBA id\n`);

  let matched = 0;
  let ambiguous = 0;
  let noPhoto = 0;
  let written = 0;

  for (const p of missing) {
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
      console.log(`  ? ${p.fullName}: ${usable.length} candidate ids, skipped`);
      continue;
    }

    matched++;
    console.log(`  ${p.fullName.padEnd(26)} → ${usable[0]}  (${how})`);
    if (dryRun) continue;

    await db
      .update(players)
      .set({ nbaPlayerId: usable[0], headshotUrl: headshot(usable[0]) })
      .where(eq(players.id, p.id));
    written++;
  }

  console.log(
    `\n${dryRun ? "would fill" : "filled"} ${dryRun ? matched : written} of ${missing.length}` +
      `\nno photo on the CDN: ${noPhoto}` +
      `\nambiguous names skipped: ${ambiguous}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
