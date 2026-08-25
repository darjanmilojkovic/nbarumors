import { config } from "dotenv";
config({ path: ".env.local" });
import { eq } from "drizzle-orm";

/**
 * Rewrite Title Case headlines to sentence case.
 *
 * The extractor wrote "Harden Stays In Cleveland On $97M Deal" while the
 * design calls for "Harden stays in Cleveland on $97M deal". CSS cannot fix
 * this — the casing is in the database.
 *
 * Deterministic rather than a model pass. We already know every proper noun
 * that matters: team cities and nicknames from the seed data, every player
 * name, every outlet, and every credited reporter. Building the dictionary
 * from our own tables is free, repeatable, and reviewable in a diff — where
 * 617 model calls would be none of those things.
 *
 * Slugs are untouched. They are the permanent URL.
 *
 *   npm run fix:case -- --dry     preview every rewrite
 *   npm run fix:case              apply
 */

/**
 * Words that are proper nouns, or conventionally capitalised, but that no
 * table of ours would contain.
 */
const ALWAYS = [
  "NBA", "WNBA", "NCAA", "FIBA", "EuroLeague", "G League", "G-League",
  "All-Star", "All-NBA", "Finals", "Christmas", "Summer League", "Olympic",
  "Olympics", "Eastern", "Western", "Conference", "MVP", "GM", "ESPN", "AP",
  "European", "American", "Team USA", "USA", "Rookie", "Sixth Man",
  "First Team", "Second Team", "Third Team", "Sign-and-Trade",
];

/**
 * Short words that stay lowercase even when a proper-noun list happens to
 * contain them — "The Athletic" must not capitalise every stray "the", and a
 * player named Day'Ron must not capitalise "day".
 */
const NEVER_PROPER = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with",
  "from", "by", "as", "is", "are", "was", "were", "be", "his", "her", "their",
  "it", "its", "he", "she", "they", "who", "after", "over", "up", "out",
  "next", "new", "big", "day", "man", "may", "will", "can", "so", "no", "not",
  "but", "if", "than", "then", "into", "back", "one", "two", "three", "deal",
  "trade", "sign", "signs", "signing", "move", "talks", "years", "year",
]);

const stripEdges = (w: string) => w.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}]+$/gu, "");
const key = (w: string) => stripEdges(w).replace(/[’']s$/i, "").toLowerCase();

function buildDictionary(phrases: string[]) {
  const single = new Map<string, string>();
  for (const phrase of phrases) {
    if (!phrase) continue;
    for (const word of phrase.split(/[\s/]+/)) {
      const k = key(word);
      const canonical = stripEdges(word);
      if (k.length < 2 || NEVER_PROPER.has(k)) continue;
      // Longest canonical form wins, so "McDonald's" beats "mcdonalds".
      if (!single.has(k) || canonical.length > single.get(k)!.length) {
        single.set(k, canonical);
      }
    }
  }
  return single;
}

/**
 * Lowercase everything except the first word, known proper nouns, and tokens
 * that carry their own casing — "$97M", "MIA", "2yr".
 */
function toSentenceCase(headline: string, dict: Map<string, string>): string {
  const parts = headline.split(/(\s+)/);
  let firstWordSeen = false;

  const out = parts.map((part) => {
    if (/^\s+$/.test(part) || part === "") return part;

    // Hyphenated compounds get each side treated on its own merits.
    const piece = part
      .split("-")
      .map((seg, segIndex) => {
        const bare = stripEdges(seg);
        if (!bare) return seg;

        const k = key(seg);
        const isFirst = !firstWordSeen && segIndex === 0;

        // Anything with a digit or a currency mark keeps its own casing.
        if (/[\d$]/.test(bare)) return seg;

        // Existing all-caps short tokens are abbreviations: NBA, MIA, GM.
        if (bare.length <= 5 && bare === bare.toUpperCase() && /^\p{Lu}+$/u.test(bare)) {
          return seg;
        }

        const proper = dict.get(k);
        if (proper && !isFirst) {
          return seg.replace(bare, proper);
        }

        const lowered = seg.replace(bare, bare.toLowerCase());
        if (isFirst) {
          const b = stripEdges(lowered);
          return lowered.replace(b, b.charAt(0).toUpperCase() + b.slice(1));
        }
        return lowered;
      })
      .join("-");

    firstWordSeen = true;
    return piece;
  });

  return out.join("");
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors, players, sources } = await import("@/db/schema");
  const { SEED_TEAMS } = await import("@/db/seed-data/teams");

  const [playerRows, sourceRows, reporterRows] = await Promise.all([
    db.select({ n: players.fullName }).from(players),
    db.select({ n: sources.name }).from(sources),
    db.select({ n: rumors.reportedBy }).from(rumors),
  ]);

  const phrases = [
    ...ALWAYS,
    ...SEED_TEAMS.flatMap((t) => [t.city, t.name, t.abbreviation]),
    ...playerRows.map((r) => r.n),
    ...sourceRows.map((r) => r.n),
    ...reporterRows.map((r) => r.n ?? ""),
  ];
  const dict = buildDictionary(phrases);
  console.log(`dictionary: ${dict.size} proper nouns\n`);

  const rows = await db
    .select({ id: rumors.id, headline: rumors.headline })
    .from(rumors);

  let changed = 0;
  for (const r of rows) {
    const next = toSentenceCase(r.headline, dict);
    if (next === r.headline) continue;
    changed++;
    console.log(`  ${r.headline}\n→ ${next}\n`);
    if (!dryRun) {
      await db.update(rumors).set({ headline: next }).where(eq(rumors.id, r.id));
    }
  }

  console.log(
    `${dryRun ? "would rewrite" : "rewrote"} ${changed} of ${rows.length} headlines`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
