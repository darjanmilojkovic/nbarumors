import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Seed `rumors.is_roundup` from the signal it replaces.
 *
 * The feed used to read "more than one primary player" as "this is a survey of
 * several situations" and dock the post 25 points. That proxy has to go before
 * primaries can go plural, because a three-player trade would otherwise be
 * demoted as if it were a roundup.
 *
 * This copies the current state rather than judging it: every post that has
 * more than one primary today gets the flag, so exactly the same posts carry
 * the penalty before and after. The front page cannot move, which is the whole
 * point of doing this step on its own.
 *
 * That does mean any post wrongly penalised today stays wrongly penalised.
 * Deliberate — correcting those is a separate judgement, and mixing it in here
 * would make a ranking change and a data change indistinguishable.
 *
 *   npx tsx src/scripts/seed-roundup-flag.ts --dry
 *   npx tsx src/scripts/seed-roundup-flag.ts --apply
 */

async function main() {
  const apply = process.argv.includes("--apply");
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as T[];

  const targets = rows<{ id: number; headline: string; n: number }>(
    await db.execute(sql`
      select r.id, r.headline,
             (select count(*)::int from rumor_players rp
               where rp.rumor_id = r.id and rp.is_primary) n
      from rumors r
      where (select count(*) from rumor_players rp
              where rp.rumor_id = r.id and rp.is_primary) > 1
      order by r.published_at desc`),
  );

  console.log(`posts with more than one primary: ${targets.length}\n`);
  for (const t of targets.slice(0, 12)) {
    console.log(`  #${t.id} (${t.n} primaries) ${t.headline.slice(0, 66)}`);
  }
  if (targets.length > 12) console.log(`  ... and ${targets.length - 12} more`);

  if (!apply) {
    console.log("\ndry run — pass --apply to write");
    return;
  }

  await db.execute(sql`
    update rumors r set is_roundup = true
    where (select count(*) from rumor_players rp
            where rp.rumor_id = r.id and rp.is_primary) > 1`);

  const [after] = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int n from rumors where is_roundup`),
  );
  console.log(`\nis_roundup now true on ${after.n} posts`);
  if (after.n !== targets.length) {
    console.log("MISMATCH — expected " + targets.length);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
