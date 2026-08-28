import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Refresh player prominence from NBA season stats + all-time scoring.
 * `npm run sync:stats` — safe to re-run.
 *
 * The work lives in src/lib/stats-sync.ts so the Vercel cron at
 * /api/cron/sync-stats runs exactly the same code path.
 */
async function main() {
  const { runStatsSync } = await import("@/lib/stats-sync");
  const r = await runStatsSync();

  for (const [season, n] of Object.entries(r.seasons)) {
    console.log(`  ${season}: ${typeof n === "number" ? `${n} qualified players` : n}`);
  }
  console.log(`  players with accolades: ${r.withAccolades}`);
  console.log(`\n  players in db: ${r.playersInDb}`);
  console.log(`  scored: ${r.scored} of ${r.playersInDb}`);
  console.log(`  new players added from leaders: ${r.inserted}`);
  console.log("\n  top prominence:");
  for (const t of r.top) {
    console.log(
      `    ${String(t.prominence).padStart(3)}  ${t.name}${t.ppg ? ` (${t.ppg} ppg)` : ""}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
