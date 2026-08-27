import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Local runner for the transaction sync. The fetch and upsert live in
 * lib/transactions, so the cron and this share one implementation.
 *
 *   npm run sync:transactions -- --dry
 *   npm run sync:transactions
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { syncTransactions } = await import("@/lib/transactions");
  const r = await syncTransactions({ dryRun });

  console.log(`  feed rows: ${r.fetched}`);
  console.log(`  within the window: ${r.considered}`);
  console.log(`  ${dryRun ? "would insert" : "inserted"}: ${r.inserted}`);
  console.log(`  newest transaction: ${r.newest?.slice(0, 10) ?? "none"}`);
  if (dryRun) console.log("\n(dry run — nothing written)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
