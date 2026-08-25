import { config } from "dotenv";
config({ path: ".env.local" });
import { eq } from "drizzle-orm";

/**
 * Strip wire-service label prefixes from headlines.
 *
 * "Report:" is how an aggregator flags that it is repeating someone else's
 * work. Every post here does that by definition, and the byline already names
 * the outlet, so the prefix carries no information and costs the first eight
 * characters of every headline.
 *
 * Slugs are deliberately left alone — they are the permanent URL, and
 * rewriting them would break every link already pointing at a post.
 *
 * `npm run fix:headlines -- --dry`
 */

const PREFIX =
  /^\s*(report|reports|rumor|rumors|rumour|rumours|update|breaking|exclusive|per report|sources?)\s*:\s*/i;

function strip(headline: string): string | null {
  const cleaned = headline.replace(PREFIX, "");
  if (cleaned === headline) return null;
  // Re-capitalise if removing the label left a lowercase opener.
  const fixed = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return fixed.trim() || null;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");

  const rows = await db
    .select({ id: rumors.id, headline: rumors.headline })
    .from(rumors);

  let changed = 0;
  for (const r of rows) {
    const next = strip(r.headline);
    if (!next) continue;
    changed++;
    console.log(`  ${r.headline.slice(0, 58)}\n    → ${next.slice(0, 58)}`);
    if (!dryRun) {
      await db.update(rumors).set({ headline: next }).where(eq(rumors.id, r.id));
    }
  }

  console.log(
    `\n${dryRun ? "would rewrite" : "rewrote"} ${changed} of ${rows.length} headlines`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
