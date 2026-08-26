import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";

/**
 * Drop player tags naming someone the post never mentions.
 *
 * Tags are written from the extraction that created a post and then stay put
 * while the text moves under them — a later report grows the summary, a
 * backfill rewrites it from the article, a repair corrects a figure. Klay
 * Thompson's buyout ended up tagged with Luka Doncic, Kyrie Irving and Anthony
 * Davis, named in an early version describing the Dallas roster he was
 * leaving and absent from every word of the post today.
 *
 * That is not cosmetic. A tag puts a player's photo on the card and the post
 * on their page, both of which assert the story is about them.
 *
 * attachSource prunes on its own after it grows a summary. This is for the
 * rewrites that already happened, and worth re-running after any bulk pass
 * that touches bodies.
 *
 *   npm run fix:tags -- --dry
 *   npm run fix:tags
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { pruneStaleTags } = await import("@/lib/tags");

  const res = await db.execute(sql`
    select distinct r.id, r.slug from rumors r
      join rumor_players rp on rp.rumor_id = r.id and not rp.is_primary
     where r.is_published
     order by r.id`);
  const rows = (res.rows ?? res) as { id: number; slug: string }[];
  console.log(`checking ${rows.length} published posts with secondary tags\n`);

  let touched = 0;
  let dropped = 0;

  for (const r of rows) {
    const names = await pruneStaleTags(r.id, { dryRun });
    if (!names.length) continue;
    touched++;
    dropped += names.length;
    console.log(`  ${r.slug}\n     ${dryRun ? "would drop" : "dropped"}: ${names.join(", ")}`);
  }

  console.log(
    `\n${dryRun ? "would drop" : "dropped"} ${dropped} tags across ${touched} posts`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
