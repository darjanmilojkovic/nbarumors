import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Make every name in a headline's list of equals take the same form.
 *
 * "Sims, Jalen Smith, Hunter and Kuzma listed as Lakers fallbacks" changes
 * gear mid-list for no reason a reader can see. The prompt now forbids it, but
 * that only reaches headlines written afterwards; seven published posts
 * already carry one.
 *
 * Hand-written rather than generated. There are only seven, each needs a
 * judgement the regex cannot make — whether the list goes to all-surnames or
 * all-full-names depends on what fits under 80 characters and on whether a
 * bare surname would be read as a team ("Washington" is a player and a club) —
 * and a headline is the most public sentence on the site.
 *
 * Which way each went:
 *
 *   All full names where they fit, because it is unambiguous. Four-name lists
 *   cannot fit, so those go to surnames instead.
 *
 * Slugs are deliberately untouched: they are permanent URLs, and regenerating
 * them would 404 anything already indexed.
 *
 *   npx tsx src/scripts/fix-mixed-name-lists.ts --dry
 *   npx tsx src/scripts/fix-mixed-name-lists.ts --apply
 */

const NEW: Record<number, string> = {
  /* Four names: all-full would run past 80, so the list goes to surnames. */
  803: "Sims, Smith, Hunter and Kuzma listed as Lakers fallbacks after Kuminga",
  771: "Sims, Smith, Kuzma and Hunter listed as Lakers fallbacks",
  /* Two or three names: full fits, and "Bridges" and "Washington" are each
     ambiguous enough that the full name is worth the characters. */
  681: "Kyrie Irving, Mikal Bridges and Jonathan Kuminga headline latest rumor roundup",
  777: "P.J. Washington and Taurean Prince to Golden State in three-team Kyrie idea",
  779: "Draymond Green and De'Anthony Melton to Portland for Jrue Holiday in trade idea",
  783: "Kevin Love, Kelly Olynyk and Gabe Vincent named as Knicks minimum options",
  792: "P.J. Washington, De'Andre Hunter and Ben Simmons named as Lakers' plan B",
};

async function main() {
  const apply = process.argv.includes("--apply");
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { sql, eq } = await import("drizzle-orm");
  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as T[];

  for (const [idStr, next] of Object.entries(NEW)) {
    const id = Number(idStr);
    const [cur] = rows<{ headline: string }>(
      await db.execute(sql`select headline from rumors where id = ${id}`),
    );
    if (!cur) {
      console.log(`#${id} NOT FOUND`);
      continue;
    }
    console.log(`#${id}`);
    console.log(`  before: ${cur.headline}  (${cur.headline.length})`);
    console.log(`  after : ${next}  (${next.length})`);

    if (next.length > 80) {
      console.log("  REFUSED: over 80 characters\n");
      continue;
    }
    if (/\beye(s|d|ing)?\b/i.test(next)) {
      console.log("  REFUSED: uses a verb we deprioritised\n");
      continue;
    }
    if (apply) {
      await db.update(rumors).set({ headline: next }).where(eq(rumors.id, id));
      console.log("  written");
    }
    console.log();
  }
  if (!apply) console.log("dry run — pass --apply to write");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
