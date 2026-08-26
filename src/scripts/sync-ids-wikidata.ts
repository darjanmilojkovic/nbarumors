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
  for (const b of json.results.bindings) {
    const k = key(b.label.value);
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), b.nbaId.value]);
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
    const ids = byName.get(key(p.fullName));
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
    console.log(`  ${p.fullName.padEnd(26)} → ${usable[0]}`);
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
