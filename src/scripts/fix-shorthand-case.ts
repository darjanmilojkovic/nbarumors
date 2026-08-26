import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * Restore capitals inside basketball shorthand that sentence case flattened.
 *
 * "3-and-D" is a position description, not a phrase — the D stands for
 * defense. The sentence-case migration had no way to know that and wrote
 * "3-and-d", and the extraction prompt then had no rule for it either.
 *
 * Deterministic and reversible: a fixed list of spellings, applied to headline
 * and body.
 *
 *   npm run fix:shorthand -- --dry
 *   npm run fix:shorthand
 */
const FIXES: [RegExp, string][] = [
  [/3-and-d\b/g, "3-and-D"],
  [/\b3 and d\b/gi, "3-and-D"],
  [/\b3&d\b/gi, "3&D"],
];

const apply = (s: string) => FIXES.reduce((acc, [re, to]) => acc.replace(re, to), s);

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");

  const res = await db.execute(sql`
    select id, slug, headline, body from rumors
     where headline ~* '(3-and-d|3 and d|3&d)' or body ~* '(3-and-d|3 and d|3&d)'`);
  const rows = (res.rows ?? res) as Record<string, string>[];

  let changed = 0;
  for (const r of rows) {
    const headline = apply(r.headline);
    const body = apply(r.body);
    if (headline === r.headline && body === r.body) continue;
    changed++;
    if (headline !== r.headline) console.log(`  ${r.headline}\n→ ${headline}`);
    if (body !== r.body) {
      const at = body.indexOf("3-and-D");
      console.log(`  body: …${body.slice(Math.max(0, at - 40), at + 30)}…`);
    }
    if (!dryRun) {
      await db.update(rumors).set({ headline, body }).where(eq(rumors.id, Number(r.id)));
    }
  }
  console.log(`\n${dryRun ? "would fix" : "fixed"} ${changed} of ${rows.length} posts mentioning the shorthand`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
