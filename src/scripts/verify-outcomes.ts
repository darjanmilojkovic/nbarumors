import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Local runner for the outcome check. The rule itself lives in lib/outcomes,
 * so the cron and this share one implementation.
 *
 *   npm run verify:outcomes -- --dry
 *   npm run verify:outcomes
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { runOutcomeCheck } = await import("@/lib/outcomes");
  const r = await runOutcomeCheck({ dryRun });

  console.log(
    `${r.posts} posts · ${r.transactions} from the transaction log · ${r.reports} from news feeds\n`,
  );
  console.log(`  confirmed by the transaction log: ${r.confirmed}`);
  console.log(`  speculative and unrecorded: ${r.unrecorded}`);
  console.log(`  confirmations withdrawn: ${r.cleared}`);
  if (r.samples.length) console.log(`\n${r.samples.map((s) => `  ${s}`).join("\n")}`);
  if (dryRun) console.log("\n(dry run — nothing written)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
