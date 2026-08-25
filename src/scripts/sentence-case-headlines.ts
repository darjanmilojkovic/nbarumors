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
  "NBA", "WNBA", "NCAA", "FIBA", "EuroLeague", "All-Star", "All-NBA",
  "Christmas", "Olympic", "Olympics", "MVP", "USA",
  // Shorthand the tables never contain, because it is not anyone's real name.
  "Philly", "Sixers", "Cavs", "Mavs", "Wolves", "Blazers", "Dubs", "Grizz",
  "Pels", "Nuggs", "Zona",
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
  /*
   * Basketball vocabulary that doubles as a surname or an outlet word.
   * "Green" and "Wright" are players; "The Athletic" is a masthead. Without
   * this, an ordinary "athletic wing" or "green light" gets capitalised.
   */
  "athletic", "guard", "guards", "forward", "center", "centre", "wing",
  "veteran", "rookie", "star", "contract", "extension", "buyout", "waiver",
  "draft", "team", "teams", "summer", "league", "finals", "conference",
  "eastern", "western", "east", "west", "point", "second", "first",
  "third", "camp", "roster", "season", "game", "games", "pick", "picks",
]);
/*
 * "green" is deliberately absent: Draymond, Jeff, Javonte and A.J. Green all
 * appear in these headlines, and blocking the word turned every one of them
 * into "Draymond green". A stray "green light" is the cheaper mistake.
 */

const stripEdges = (w: string) => w.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}]+$/gu, "");
/**
 * The stored spelling of a name, never its possessive. Learning "Australia's"
 * as the canonical form and then substituting it into "Australia's" produced
 * "Australia's's", which also made the script non-idempotent.
 */
const canon = (w: string) => stripEdges(w).replace(/[’']s$/i, "");
const key = (w: string) => canon(w).toLowerCase();

/**
 * Swap in the canonical spelling without eating a possessive. The dictionary
 * is keyed on "lebron", so a naive replace over "Lebron's" matched the whole
 * token and returned "LeBron", quietly dropping the apostrophe-s.
 */
function applyProper(token: string, canonical: string): string {
  const bare = stripEdges(token);
  const possessive = bare.match(/[’']s$/i)?.[0] ?? "";
  const name = possessive ? bare.slice(0, -possessive.length) : bare;
  return token.replace(name, canonical);
}

function buildDictionary(phrases: string[]) {
  const single = new Map<string, string>();
  for (const phrase of phrases) {
    if (!phrase) continue;
    for (const word of phrase.split(/[\s/]+/)) {
      const k = key(word);
      const canonical = canon(word);
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
 * Learn proper nouns from our own prose.
 *
 * The bodies are already written in normal sentence case, which makes them a
 * labelled corpus: a word that appears lowercase mid-sentence is an ordinary
 * word, and a word that only ever appears capitalised mid-sentence is a name.
 * That is how "Olimpia Milano" and "EuroLeague" survive without anyone
 * maintaining a list of every club on earth.
 *
 * Sentence-initial words are skipped — they are capitalised by grammar, not
 * because of what they are.
 */
function learnFromBodies(bodies: string[]) {
  const capitalised = new Map<string, string>();
  const lowercased = new Set<string>();

  for (const body of bodies) {
    if (!body) continue;
    for (const sentence of body.split(/(?<=[.!?])\s+/)) {
      const words = sentence.split(/[\s/]+/);
      words.forEach((word, i) => {
        const bare = stripEdges(word);
        const k = key(word);
        if (!bare || k.length < 2 || /[\d$]/.test(bare)) return;
        if (bare[0] === bare[0].toLowerCase()) {
          lowercased.add(k);
          return;
        }
        if (i === 0) return; // capitalised only because it opens a sentence
        if (!capitalised.has(k)) capitalised.set(k, canon(word));
      });
    }
  }

  const learned = new Map<string, string>();
  for (const [k, canonical] of capitalised) {
    if (lowercased.has(k) || NEVER_PROPER.has(k)) continue;
    learned.set(k, canonical);
  }
  return learned;
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

    /*
     * Try the whole token before splitting on hyphens. "Caldwell-Pope" is one
     * entry in the dictionary; segment-by-segment lookup missed it and
     * produced "caldwell-pope".
     */
    /*
     * Known names win outright, including in first position. Running the
     * first-word rule over them lowercased the whole token before
     * re-capitalising the initial, which flattened every intercap: LeBron
     * became Lebron and DeRozan became Derozan.
     */
    const wholeBare = stripEdges(part);
    const whole = dict.get(key(part));
    if (whole && wholeBare) {
      firstWordSeen = true;
      return applyProper(part, whole);
    }

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

        /*
         * Abbreviations keep their caps: NBA, MIA, GM. Two letters minimum —
         * at one it swallowed the article in "Tyreke Key A 10-Day Deal".
         */
        if (
          bare.length >= 2 &&
          bare.length <= 5 &&
          bare === bare.toUpperCase() &&
          /^\p{Lu}+$/u.test(bare)
        ) {
          return seg;
        }

        // Same rule per hyphen segment: a known name keeps its own casing.
        const proper = dict.get(k);
        if (proper) {
          return applyProper(seg, proper);
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
  const rows = await db
    .select({ id: rumors.id, headline: rumors.headline, body: rumors.body })
    .from(rumors);

  const dict = buildDictionary(phrases);
  const known = dict.size;

  // Names the tables do not know, learned from how we write about them.
  for (const [k, canonical] of learnFromBodies(rows.map((r) => r.body))) {
    if (!dict.has(k)) dict.set(k, canonical);
  }
  console.log(
    `dictionary: ${known} from tables + ${dict.size - known} learned from bodies = ${dict.size}\n`,
  );

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
