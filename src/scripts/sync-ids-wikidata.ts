import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Local runner for player discovery. The matching itself lives in
 * lib/discover-players, so the cron and this share one implementation.
 *
 * Unlike the cron, this caches the headshots as it goes — it runs on a machine
 * that can write to public/, so commit whatever appears there afterwards.
 *
 *   npm run sync:ids -- --dry    preview
 *   npm run sync:ids             apply
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { discoverPlayers } = await import("@/lib/discover-players");
  const r = await discoverPlayers({ dryRun, cacheImages: !dryRun });

  console.log(`${r.candidates} players without an NBA id\n`);
  for (const s of r.samples) console.log(`  ${s}`);

  console.log(
    `\n${dryRun ? "would fill" : "filled"} ${r.matched} of ${r.candidates}` +
      `\nheadshots cached: ${r.cached}` +
      `\nno photo on the CDN: ${r.noPhoto}` +
      `\nid already held by another row: ${r.taken}` +
      `\nambiguous names skipped: ${r.ambiguous}`,
  );
  if (dryRun) console.log("\n(dry run — nothing downloaded or written)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
